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

// src/update-urls.ts
var update_urls_exports = {};
__export(update_urls_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(update_urls_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var handler = async (event) => {
  for (const update of event.updates) {
    await dynamo.send(new import_client_dynamodb.UpdateItemCommand({
      TableName: process.env.AUDIO_FILES_TABLE,
      Key: { id: { S: update.id } },
      UpdateExpression: "SET file_url = :url",
      ExpressionAttributeValues: {
        ":url": { S: update.new_file_url }
      }
    }));
    console.log(`Updated URL for: ${update.id}`);
  }
  return { statusCode: 200, body: `Updated ${event.updates.length} URLs` };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
