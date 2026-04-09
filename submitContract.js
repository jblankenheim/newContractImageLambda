import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

/* ───────── AWS CLIENTS ───────── */
const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/* ───────── CONSTANTS ───────── */
const BUCKET_NAME =
  "contractmanagerb1bd6cee78584d3aa42032b80af01721cb23f-prod";

const TABLE_NAME =
  "Contract-26im7u6mzvfcxcf4im4hpyglga-prod";

/* ───────── CORS ───────── */
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://main.d2zj7743zlfb73.amplifyapp.com",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST"
};

/* ───────── HANDLER ───────── */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const contractType = body.contractType;
    const contractNumber = Number(body.contractNumber);
    const pictureKey = body.pictureKey;
    const confidenceNumber = body.confidenceNumber;

    if (!contractType || Number.isNaN(contractNumber) || !pictureKey) {
      return error(400, "Invalid contractType, contractNumber, or pictureKey");
    }

    const id = `${contractType}#${contractNumber}`;
    const now = new Date().toISOString();

    const fileName = pictureKey.split("/").pop();
    const safeType = contractType.replace(/ /g, "_");

    const newPictureKey =
      `contracts/${safeType}/${contractNumber}/${fileName}`;

    const duplicateKey =
      `contracts/${safeType}/${contractNumber}/${fileName}_duplicate`;

    /* 🔍 Existing record */
    const existing = await dynamo.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id }
      })
    );

    /* ───── CREATE ───── */
    if (!existing.Item) {
      await moveFile(pictureKey, newPictureKey);

      await dynamo.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            id,
            contractType,
            contractNumber,
            pictureKey: newPictureKey,
            confidenceNumber,
            contractSigned: true,
            signedAt: now,
            createdAt: now,
            updatedAt: now
          },
          ConditionExpression: "attribute_not_exists(id)"
        })
      );

      return success("CREATED", newPictureKey);
    }

    /* ───── UPDATE (first signature) ───── */
    if (!existing.Item.pictureKey) {
      await moveFile(pictureKey, newPictureKey);

      await dynamo.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression:
            "SET pictureKey = :pk, confidenceNumber = :c, contractSigned = :cs, signedAt = :s, updatedAt = :u",
          ExpressionAttributeValues: {
            ":pk": newPictureKey,
            ":c": confidenceNumber,
            ":cs": true,
            ":s": now,
            ":u": now
          }
        })
      );

      return success("UPDATED_WITH_FILE", newPictureKey);
    }

    /* ───── DUPLICATE ───── */
    await moveFile(pictureKey, duplicateKey);

    await dynamo.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id },
        UpdateExpression:
          "SET duplicateKey = :dk, updatedAt = :u",
        ExpressionAttributeValues: {
          ":dk": duplicateKey,
          ":u": now
        }
      })
    );

    return success("DUPLICATE", duplicateKey);

  } catch (err) {
    console.error("LAMBDA ERROR:", err);
    return error(500, err.message || "Internal Server Error");
  }
};

/* ───────── HELPERS ───────── */

async function moveFile(oldKey, newKey) {
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${encodeURIComponent(oldKey)}`,
      Key: newKey
    })
  );

  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: oldKey
    })
  );
}

function success(status, pictureKey) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ status, pictureKey })
  };
}

function error(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify({ error: message })
  };
}
