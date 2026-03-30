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

// src/api.ts
var api_exports = {};
__export(api_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(api_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var import_client_sns = require("@aws-sdk/client-sns");
var import_client_sqs = require("@aws-sdk/client-sqs");
var import_crypto = require("crypto");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var s3 = new import_client_s3.S3Client({});
var sns = new import_client_sns.SNSClient({});
var sqs = new import_client_sqs.SQSClient({});
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    },
    body: JSON.stringify(body)
  };
}
function fromDynamo(item) {
  const result = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== void 0) result[key] = value.S;
    else if (value.N !== void 0) result[key] = Number(value.N);
    else if (value.BOOL !== void 0) result[key] = value.BOOL;
    else if (value.NULL) result[key] = null;
    else if (value.L) result[key] = value.L.map((v) => v.S || v.N || v);
    else if (value.SS) result[key] = value.SS;
  }
  return result;
}
async function listAudioFiles(event) {
  const params = event.queryStringParameters || {};
  const page = parseInt(params.page || "1");
  const pageSize = parseInt(params.pageSize || "10");
  const result = await dynamo.send(new import_client_dynamodb.QueryCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    IndexName: "created_at-index",
    KeyConditionExpression: "item_type = :type",
    ExpressionAttributeValues: {
      ":type": { S: "AUDIO" }
    },
    ScanIndexForward: false,
    // Descending order (newest first)
    Limit: pageSize * page
    // Fetch enough to paginate
  }));
  const allItems = (result.Items || []).map(fromDynamo);
  const start = (page - 1) * pageSize;
  const paged = allItems.slice(start, start + pageSize);
  const countResult = await dynamo.send(new import_client_dynamodb.QueryCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    IndexName: "created_at-index",
    KeyConditionExpression: "item_type = :type",
    ExpressionAttributeValues: {
      ":type": { S: "AUDIO" }
    },
    Select: "COUNT"
  }));
  return respond(200, { data: paged, totalCount: countResult.Count || 0 });
}
async function getAudioFile(id) {
  const result = await dynamo.send(new import_client_dynamodb.GetItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: id } }
  }));
  if (!result.Item) return respond(404, { error: "Not found" });
  return respond(200, fromDynamo(result.Item));
}
async function createAudioFile(event) {
  const body = JSON.parse(event.body || "{}");
  const id = (0, import_crypto.randomUUID)();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const item = {
    id: { S: id },
    item_type: { S: "AUDIO" },
    title: { S: body.title },
    file_url: { S: body.file_url },
    uploaded_by: { S: body.uploaded_by },
    created_at: { S: createdAt },
    tags: { L: [] }
  };
  if (body.description) item.description = { S: body.description };
  if (body.duration) item.duration = { N: body.duration.toString() };
  await dynamo.send(new import_client_dynamodb.PutItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Item: item
  }));
  const created = {
    id,
    title: body.title,
    description: body.description,
    file_url: body.file_url,
    duration: body.duration,
    uploaded_by: body.uploaded_by,
    created_at: createdAt,
    tags: []
  };
  if (process.env.UPLOAD_QUEUE_URL) {
    await sqs.send(new import_client_sqs.SendMessageCommand({
      QueueUrl: process.env.UPLOAD_QUEUE_URL,
      MessageBody: JSON.stringify({
        audioFileId: id,
        s3Key: body.file_url.split(".amazonaws.com/")[1]
      })
    }));
  }
  if (process.env.NEW_UPLOAD_TOPIC_ARN) {
    await sns.send(new import_client_sns.PublishCommand({
      TopicArn: process.env.NEW_UPLOAD_TOPIC_ARN,
      Subject: `New upload: ${body.title}`,
      Message: JSON.stringify(created)
    }));
  }
  return respond(201, created);
}
async function updateAudioFile(id, event) {
  const body = JSON.parse(event.body || "{}");
  const updateParts = [];
  const exprValues = {};
  const exprNames = {};
  if (body.title !== void 0) {
    updateParts.push("#title = :title");
    exprNames["#title"] = "title";
    exprValues[":title"] = { S: body.title };
  }
  if (body.description !== void 0) {
    updateParts.push("#desc = :desc");
    exprNames["#desc"] = "description";
    exprValues[":desc"] = { S: body.description };
  }
  if (updateParts.length === 0) return respond(400, { error: "Nothing to update" });
  const result = await dynamo.send(new import_client_dynamodb.UpdateItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: id } },
    UpdateExpression: `SET ${updateParts.join(", ")}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ReturnValues: "ALL_NEW"
  }));
  if (!result.Attributes) return respond(404, { error: "Not found" });
  return respond(200, fromDynamo(result.Attributes));
}
async function deleteAudioFile(id) {
  await dynamo.send(new import_client_dynamodb.DeleteItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: id } }
  }));
  return respond(204, null);
}
async function addTag(audioFileId, event) {
  const { name } = JSON.parse(event.body || "{}");
  await dynamo.send(new import_client_dynamodb.UpdateItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    UpdateExpression: "SET tags = list_append(if_not_exists(tags, :empty), :tag)",
    ConditionExpression: "NOT contains(tags, :tagVal)",
    ExpressionAttributeValues: {
      ":tag": { L: [{ S: name }] },
      ":empty": { L: [] },
      ":tagVal": { S: name }
    }
  })).catch((err) => {
    if (err.name !== "ConditionalCheckFailedException") throw err;
  });
  return respond(201, { name });
}
async function getTags(audioFileId) {
  const result = await dynamo.send(new import_client_dynamodb.GetItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    ProjectionExpression: "tags"
  }));
  const tags = result.Item?.tags?.L?.map((t) => t.S) || [];
  return respond(200, tags);
}
async function removeTag(audioFileId, event) {
  const { name } = JSON.parse(event.body || "{}");
  const result = await dynamo.send(new import_client_dynamodb.GetItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    ProjectionExpression: "tags"
  }));
  const currentTags = result.Item?.tags?.L?.map((t) => t.S) || [];
  const newTags = currentTags.filter((t) => t !== name);
  await dynamo.send(new import_client_dynamodb.UpdateItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    UpdateExpression: "SET tags = :tags",
    ExpressionAttributeValues: {
      ":tags": { L: newTags.map((t) => ({ S: t })) }
    }
  }));
  return respond(204, null);
}
async function getComments(audioFileId) {
  const result = await dynamo.send(new import_client_dynamodb.QueryCommand({
    TableName: process.env.COMMENTS_TABLE,
    KeyConditionExpression: "audio_file_id = :id",
    ExpressionAttributeValues: {
      ":id": { S: audioFileId }
    },
    ScanIndexForward: true
    // Oldest first
  }));
  return respond(200, (result.Items || []).map(fromDynamo));
}
async function addComment(audioFileId, event) {
  const body = JSON.parse(event.body || "{}");
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const id = (0, import_crypto.randomUUID)();
  await dynamo.send(new import_client_dynamodb.PutItemCommand({
    TableName: process.env.COMMENTS_TABLE,
    Item: {
      audio_file_id: { S: audioFileId },
      created_at: { S: createdAt },
      id: { S: id },
      user_id: { S: body.user_id },
      content: { S: body.content }
    }
  }));
  return respond(201, {
    id,
    audio_file_id: audioFileId,
    user_id: body.user_id,
    content: body.content,
    created_at: createdAt
  });
}
async function getUploadUrl(event) {
  const { filename, contentType } = JSON.parse(event.body || "{}");
  const key = `uploads/${Date.now()}-${filename}`;
  const command = new import_client_s3.PutObjectCommand({
    Bucket: process.env.AUDIO_BUCKET,
    Key: key,
    ContentType: contentType
  });
  const uploadUrl = await (0, import_s3_request_presigner.getSignedUrl)(s3, command, { expiresIn: 300 });
  return respond(200, {
    uploadUrl,
    fileUrl: `https://${process.env.AUDIO_BUCKET}.s3.amazonaws.com/${key}`
  });
}
async function addReaction(audioFileId, event) {
  const { user_id, reaction_type } = JSON.parse(event.body || "{}");
  await dynamo.send(new import_client_dynamodb.PutItemCommand({
    TableName: process.env.REACTIONS_TABLE,
    Item: {
      audio_file_id: { S: audioFileId },
      user_id: { S: user_id },
      reaction_type: { S: reaction_type },
      created_at: { S: (/* @__PURE__ */ new Date()).toISOString() }
    }
  }));
  return respond(201, { audio_file_id: audioFileId, user_id, reaction_type });
}
async function getReactions(audioFileId) {
  const result = await dynamo.send(new import_client_dynamodb.QueryCommand({
    TableName: process.env.REACTIONS_TABLE,
    KeyConditionExpression: "audio_file_id = :id",
    ExpressionAttributeValues: {
      ":id": { S: audioFileId }
    }
  }));
  return respond(200, (result.Items || []).map(fromDynamo));
}
async function removeReaction(audioFileId, event) {
  const { user_id } = JSON.parse(event.body || "{}");
  await dynamo.send(new import_client_dynamodb.DeleteItemCommand({
    TableName: process.env.REACTIONS_TABLE,
    Key: {
      audio_file_id: { S: audioFileId },
      user_id: { S: user_id }
    }
  }));
  return respond(204, null);
}
var handler = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (method === "OPTIONS") return respond(200, {});
  try {
    if (path === "/audio" && method === "GET") return await listAudioFiles(event);
    if (path === "/audio" && method === "POST") return await createAudioFile(event);
    const audioMatch = path.match(/^\/audio\/([^/]+)$/);
    if (audioMatch) {
      const id = audioMatch[1];
      if (method === "GET") return await getAudioFile(id);
      if (method === "PUT") return await updateAudioFile(id, event);
      if (method === "DELETE") return await deleteAudioFile(id);
    }
    const tagsMatch = path.match(/^\/audio\/([^/]+)\/tags$/);
    if (tagsMatch) {
      const id = tagsMatch[1];
      if (method === "GET") return await getTags(id);
      if (method === "POST") return await addTag(id, event);
      if (method === "DELETE") return await removeTag(id, event);
    }
    const commentsMatch = path.match(/^\/audio\/([^/]+)\/comments$/);
    if (commentsMatch) {
      const id = commentsMatch[1];
      if (method === "GET") return await getComments(id);
      if (method === "POST") return await addComment(id, event);
    }
    if (path === "/upload-url" && method === "POST") return await getUploadUrl(event);
    const reactionsMatch = path.match(/^\/audio\/([^/]+)\/reactions$/);
    if (reactionsMatch) {
      const id = reactionsMatch[1];
      if (method === "GET") return await getReactions(id);
      if (method === "POST") return await addReaction(id, event);
      if (method === "DELETE") return await removeReaction(id, event);
    }
    return respond(404, { error: "Not found" });
  } catch (err) {
    console.error("API error:", err);
    return respond(500, { error: "Internal server error" });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
