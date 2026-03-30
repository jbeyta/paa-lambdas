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

// src/clip-of-the-day.ts
var clip_of_the_day_exports = {};
__export(clip_of_the_day_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(clip_of_the_day_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_client_ses = require("@aws-sdk/client-ses");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var ses = new import_client_ses.SESClient({});
function fromDynamo(item) {
  const result = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== void 0) result[key] = value.S;
    else if (value.N !== void 0) result[key] = Number(value.N);
    else if (value.L) result[key] = value.L.map((v) => v.S || v.N || v);
  }
  return result;
}
var handler = async () => {
  const result = await dynamo.send(new import_client_dynamodb.ScanCommand({
    TableName: process.env.AUDIO_FILES_TABLE
  }));
  const files = (result.Items || []).map(fromDynamo);
  if (files.length === 0) {
    console.error("No files found");
    return { statusCode: 500, body: "No files available" };
  }
  const clip = files[Math.floor(Math.random() * files.length)];
  const appUrl = process.env.APP_URL;
  const emailBody = `
    <h2>\u{1F3B5} Clip of the Day</h2>
    <p><strong>${clip.title}</strong></p>
    ${clip.description ? `<p>${clip.description}</p>` : ""}
    <p>Uploaded: ${new Date(clip.created_at).toLocaleDateString()}</p>
    <p><a href="${appUrl}/audio/${clip.id}">Listen now \u2192</a></p>
    <br>
    <p style="color: #666; font-size: 12px;">
      Keep your ideas fresh \u2014 one clip at a time.
    </p>
  `;
  await ses.send(new import_client_ses.SendEmailCommand({
    Source: process.env.FROM_EMAIL,
    Destination: {
      ToAddresses: [process.env.TO_EMAIL]
    },
    Message: {
      Subject: { Data: `\u{1F3B5} Clip of the Day: ${clip.title}` },
      Body: {
        Html: { Data: emailBody }
      }
    }
  }));
  console.log(`Sent Clip of the Day: ${clip.title} (${clip.id})`);
  return { statusCode: 200, body: `Sent: ${clip.title}` };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
