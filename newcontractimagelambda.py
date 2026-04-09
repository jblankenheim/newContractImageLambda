

import base64
import boto3
import json
import os
import re
import tempfile

from pypdf import PdfReader
from pdf2image import convert_from_path
import pytesseract



BUCKET = "contractmanagerb1bd6cee78584d3aa42032b80af01721cb23f-prod"

pytesseract.pytesseract.tesseract_cmd = "/opt/bin/tesseract"
POPPLER_PATH = "/opt/bin"

s3 = boto3.client("s3")


CONTRACT_PATTERN = re.compile(
    r"""
    Contract
    (?:\s*No\.?)?
    \s*[:\.]?\s*
    (\d+)
    """,
    re.IGNORECASE | re.VERBOSE
)

CONTRACT_TYPES = {
    "Minimum Price": ["minimum price", "min price"],
    "Cash Buy": ["cash buy"],
    "Extended Pricing": ["extended pricing"],
    "Deferred Payment": ["deferred payment"],
    "Price Later": ["price later", "priced later"],
    "Basis Fixed": ["basis fixed"],
    "Hedged-To-Arrive": ["hedged to arrive","hedge to arrive", "hedged-to-arrive", "hta"]
}


def normalize_text(text: str) -> str:
    text = text.lower().replace("-", " ")
    return " ".join(text.split())


def detect_contract_type(text: str) -> str:
    text = normalize_text(text)
    for ct, patterns in CONTRACT_TYPES.items():
        for p in patterns:
            if p in text:
                return ct
    return "Unknown"



def lambda_handler(event, context):
  
     

    picture_key = event["pictureKey"]
    file_bytes = base64.b64decode(event["fileBase64"])

    with tempfile.TemporaryDirectory() as tmpdir:
        local_pdf = os.path.join(tmpdir, picture_key)

        # ----------------------------------------------
        # 1. Write file locally
        # ----------------------------------------------
        with open(local_pdf, "wb") as f:
            f.write(file_bytes)


        incoming_key = f"incoming/{picture_key}"
        s3.upload_file(local_pdf, BUCKET, incoming_key)

        reader = PdfReader(local_pdf)
        all_text = ""
        contract_numbers = []


        for page_idx, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""

            if not text.strip():
                images = convert_from_path(
                    local_pdf,
                    poppler_path=POPPLER_PATH,
                    first_page=page_idx,
                    last_page=page_idx
                )

                for angle in [0, 90, 180, 270]:
                    rotated = images[0].rotate(angle, expand=True)
                    text = pytesseract.image_to_string(rotated)

                    matches = CONTRACT_PATTERN.findall(text)
                    if matches:
                        contract_numbers.extend(matches)
                        break
            else:
                matches = CONTRACT_PATTERN.findall(text)
                contract_numbers.extend(matches)

            all_text += "\n" + text


        contract_number = contract_numbers[0] if contract_numbers else None
        contract_type = detect_contract_type(all_text)

        confidence = 0.0
        if contract_number:
            confidence += 0.6
        if contract_type != "Unknown":
            confidence += 0.4
        confidence = round(confidence, 2)


        review_prefix = f"review/{contract_type}/{contract_number}"
        review_key = f"{review_prefix}/{picture_key}"

        s3.copy_object(
            Bucket=BUCKET,
            CopySource={"Bucket": BUCKET, "Key": incoming_key},
            Key=review_key
        )

        s3.delete_object(Bucket=BUCKET, Key=incoming_key)

 
    return {
        "pictureKey": review_prefix,
        "contractNumber": contract_number,
        "contractType": contract_type,
        "confidenceNumber": confidence
    }
