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

// src/migrate-data.ts
var migrate_data_exports = {};
__export(migrate_data_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(migrate_data_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var handler = async (event) => {
  let count = 0;
  for (const file of event.files) {
    await dynamo.send(new import_client_dynamodb.PutItemCommand({
      TableName: process.env.AUDIO_FILES_TABLE,
      Item: {
        id: { S: file.id },
        item_type: { S: "AUDIO" },
        title: { S: file.title },
        ...file.description && { description: { S: file.description } },
        file_url: { S: file.file_url },
        ...file.duration && { duration: { N: file.duration.toString() } },
        uploaded_by: { S: file.uploaded_by || "unknown" },
        created_at: { S: file.created_at },
        tags: { L: [] }
      }
    }));
    console.log(`Migrated: ${file.title}`);
    count++;
  }
  return { statusCode: 200, body: `Migrated ${count} files` };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
