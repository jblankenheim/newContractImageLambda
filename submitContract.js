
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
  
  const s3 = new S3Client({});
  const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  
  const BUCKET_NAME =
    "contractmanagerb1bd6cee78584d3aa42032b80af01721cb23f-prod";
  
  const TABLE_NAME = "Contract";
  
  export const handler = async (event) => {
    try {
      const body =
        typeof event.body === "string"
          ? JSON.parse(event.body)
          : event;
  
      const contractType = body.contractType;
      const contractNumber = Number(body.contractNumber);
      const pictureKey = body.pictureKey;
      const confidenceNumber = body.confidenceNumber;
  
      if (!contractType || !contractNumber || !pictureKey) {
        return error(
          400,
          "Missing required fields: contractType, contractNumber, pictureKey"
        );
      }
  
      const fileName = pictureKey.split("/").pop();
      const safeType = contractType.replace(/ /g, "_");
  
      const newPictureKey =
        `contracts/${safeType}/${contractNumber}/${fileName}`;
  
      const duplicateKey =
        `contracts/${safeType}/${contractNumber}/${fileName}_duplicate`;
  
      const key = {
        contractType,
        contractNumber
      };
  
      // 🔍 Check if contract already exists
      const existing = await dynamo.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: key
        })
      );
  
      // ─────────── CREATE ───────────
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
  
      // ─────────── UPDATE (no picture yet) ───────────
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
  
      // ─────────── DUPLICATE ───────────
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
      console.error("ERROR:", err);
      return error(500, err.message);
    }
  };
  
  // 🔁 Move file helper
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
  
  // ✅ Response helpers
  function success(status, pictureKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({ status, pictureKey })
    };
  }
  
  function error(statusCode, message) {
    return {
      statusCode,
      body: JSON.stringify({ error: message })
    };
  }
  
