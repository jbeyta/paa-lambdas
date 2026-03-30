"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/process-upload.ts
var process_upload_exports = {};
__export(process_upload_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(process_upload_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var s3 = new import_client_s3.S3Client({});
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var handler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    console.log(`Processing upload: ${message.audioFileId}`);
    try {
      const head = await s3.send(new import_client_s3.HeadObjectCommand({
        Bucket: process.env.AUDIO_BUCKET,
        Key: message.s3Key
      }));
      await dynamo.send(new import_client_dynamodb.UpdateItemCommand({
        TableName: process.env.AUDIO_FILES_TABLE,
        Key: { id: { S: message.audioFileId } },
        UpdateExpression: "SET file_size = :size, content_type = :type",
        ExpressionAttributeValues: {
          ":size": { N: (head.ContentLength || 0).toString() },
          ":type": { S: head.ContentType || "unknown" }
        }
      }));
      console.log(`Processed: ${message.audioFileId}`);
    } catch (err) {
      console.error(`Error processing ${message.audioFileId}:`, err);
      throw err;
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
