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

/* ─────────────────── AWS CLIENTS ─────────────────── */
const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/* ─────────────────── CONSTANTS ─────────────────── */
const BUCKET_NAME =
  "contractmanagerb1bd6cee78584d3aa42032b80af01721cb23f-prod";

const TABLE_NAME = "Contract";

/* ─────────────────── CORS HEADERS ─────────────────── */
const corsHeaders = {
  "Access-Control-Allow-Origin":
    "https://main.d2zj7743zlfb73.amplifyapp.com",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization",
  "Access-Control-Allow-Methods":
    "OPTIONS,POST"
};

/* ─────────────────── HANDLER ─────────────────── */
export const handler = async (event) => {

  /* ✅ Handle preflight */
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ""
    };
  }

  try {
    /* ✅ Safe body parsing */
    const body = event.body ? JSON.parse(event.body) : {};

    const contractType = body.contractType;
    const contractNumber = Number(body.contractNumber);
    const pictureKey = body.pictureKey;
    const confidenceNumber = body.confidenceNumber;

    /* ✅ Correct validation */
    if (
      !contractType ||
      !pictureKey ||
      Number.isNaN(contractNumber)
    ) {
      return error(
        400,
        "Missing or invalid fields: contractType, contractNumber, pictureKey"
      );
    }

    const fileName = pictureKey.split("/").pop();
    const safeType = contractType.replace(/ /g, "_");

    const newPictureKey =
      `contracts/${safeType}/${contractNumber}/${fileName}`;

    const duplicateKey =
      `contracts/${safeType}/${contractNumber}/${fileName}_duplicate`;

    const key = { contractType, contractNumber };

    /* 🔍 Check existing record */
    const existing = await dynamo.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: key
      })
    );

    /* ─────────── CREATE ─────────── */
    if (!existing.Item) {
      await moveFile(pictureKey, newPictureKey);

      await dynamo.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...key,
            pictureKey: newPictureKey,
            confidenceNumber
          },
          ConditionExpression:
            "attribute_not_exists(contractType)"
        })
      );

      return success("CREATED", newPictureKey);
    }

    /* ─────────── UPDATE (no picture yet) ─────────── */
    if (!existing.Item.pictureKey) {
      await moveFile(pictureKey, newPictureKey);

      await dynamo.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: key,
          UpdateExpression:
            "SET pictureKey = :pk, confidenceNumber = :c",
          ExpressionAttributeValues: {
            ":pk": newPictureKey,
            ":c": confidenceNumber
          }
        })
      );

      return success("UPDATED_WITH_FILE", newPictureKey);
    }

    /* ─────────── DUPLICATE ─────────── */
    await moveFile(pictureKey, duplicateKey);

    await dynamo.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression:
          "SET duplicateKey = :dk",
        ExpressionAttributeValues: {
          ":dk": duplicateKey
        }
      })
    );

    return success("DUPLICATE", duplicateKey);

  } catch (err) {
    console.error("LAMBDA ERROR:", err);
    return error(500, err.message || "Internal Server Error");
  }
};

/* ─────────────────── HELPERS ─────────────────── */

async function moveFile(oldKey, newKey) {
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${oldKey}`,
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
