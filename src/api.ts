import { 
  DynamoDBClient, 
  PutItemCommand, 
  GetItemCommand, 
  DeleteItemCommand, 
  QueryCommand, 
  UpdateItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { randomUUID } from "crypto";

// --- Clients ---

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const sns = new SNSClient({});
const sqs = new SQSClient({});

// --- Helpers ---

function respond(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

// Convert DynamoDB item to a plain object
function fromDynamo(item: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== undefined) result[key] = value.S;
    else if (value.N !== undefined) result[key] = Number(value.N);
    else if (value.BOOL !== undefined) result[key] = value.BOOL;
    else if (value.NULL) result[key] = null;
    else if (value.L) result[key] = value.L.map((v: any) => v.S || v.N || v);
    else if (value.SS) result[key] = value.SS;
  }
  return result;
}

// --- Audio Files ---

async function listAudioFiles(event: APIGatewayProxyEventV2) {
  const params = event.queryStringParameters || {};
  const page = parseInt(params.page || "1");
  const pageSize = parseInt(params.pageSize || "10");
  const tag = params.tag;
  const search = params.search?.toLowerCase();
  const sortBy = params.sortBy || "created_at";  // "created_at" or "title"
  const sortOrder = params.sortOrder || "desc";   // "asc" or "desc"

  // Query the GSI for all items
  const result = await dynamo.send(new QueryCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    IndexName: "created_at-index",
    KeyConditionExpression: "item_type = :type",
    ExpressionAttributeValues: {
      ":type": { S: "AUDIO" },
    },
    ScanIndexForward: false,
  }));

  let items = (result.Items || []).map(fromDynamo);

  // Filter by tag
  if (tag) {
    items = items.filter(item =>
      item.tags && item.tags.includes(tag)
    );
  }

  // Filter by search text (title and description)
  if (search) {
    items = items.filter(item =>
      (item.title && item.title.toLowerCase().includes(search)) ||
      (item.description && item.description.toLowerCase().includes(search))
    );
  }

  // Sort
  items.sort((a, b) => {
    const aVal = a[sortBy] || "";
    const bVal = b[sortBy] || "";
    if (sortOrder === "asc") return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
  });

  // Paginate
  const totalCount = items.length;
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return respond(200, { data: paged, totalCount });
}

async function getAudioFile(id: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: id } },
  }));

  if (!result.Item) return respond(404, { error: "Not found" });
  return respond(200, fromDynamo(result.Item));
}

async function listAllTags() {
  const result = await dynamo.send(new QueryCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    IndexName: "created_at-index",
    KeyConditionExpression: "item_type = :type",
    ExpressionAttributeValues: {
      ":type": { S: "AUDIO" },
    },
    ProjectionExpression: "tags",
  }));

  const allTags = new Set<string>();
  for (const item of result.Items || []) {
    const tags = item.tags?.L?.map((t: any) => t.S) || [];
    tags.forEach((t: string) => allTags.add(t));
  }

  return respond(200, Array.from(allTags).sort());
}

async function createAudioFile(event: APIGatewayProxyEventV2) {
  const body = JSON.parse(event.body || "{}");
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  const item: Record<string, any> = {
    id: { S: id },
    item_type: { S: "AUDIO" },
    title: { S: body.title },
    file_url: { S: body.file_url },
    uploaded_by: { S: body.uploaded_by },
    created_at: { S: createdAt },
    tags: { L: [] },
  };

  if (body.description) item.description = { S: body.description };
  if (body.duration) item.duration = { N: body.duration.toString() };

  await dynamo.send(new PutItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Item: item,
  }));

  const created = {
    id, title: body.title, description: body.description,
    file_url: body.file_url, duration: body.duration,
    uploaded_by: body.uploaded_by, created_at: createdAt, tags: [],
  };

  // Queue for background processing
  if (process.env.UPLOAD_QUEUE_URL) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.UPLOAD_QUEUE_URL,
      MessageBody: JSON.stringify({
        audioFileId: id,
        s3Key: body.file_url.split(".amazonaws.com/")[1],
      }),
    }));
  }

  // Notify subscribers
  if (process.env.NEW_UPLOAD_TOPIC_ARN) {
    await sns.send(new PublishCommand({
      TopicArn: process.env.NEW_UPLOAD_TOPIC_ARN,
      Subject: `New upload: ${body.title}`,
      Message: JSON.stringify(created),
    }));
  }

  return respond(201, created);
}

async function updateAudioFile(id: string, event: APIGatewayProxyEventV2) {
  const body = JSON.parse(event.body || "{}");

  const updateParts: string[] = [];
  const exprValues: Record<string, any> = {};
  const exprNames: Record<string, string> = {};

  if (body.title !== undefined) {
    updateParts.push("#title = :title");
    exprNames["#title"] = "title";
    exprValues[":title"] = { S: body.title };
  }
  if (body.description !== undefined) {
    updateParts.push("#desc = :desc");
    exprNames["#desc"] = "description";
    exprValues[":desc"] = { S: body.description };
  }

  if (updateParts.length === 0) return respond(400, { error: "Nothing to update" });

  const result = await dynamo.send(new UpdateItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: id } },
    UpdateExpression: `SET ${updateParts.join(", ")}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ReturnValues: "ALL_NEW",
  }));

  if (!result.Attributes) return respond(404, { error: "Not found" });
  return respond(200, fromDynamo(result.Attributes));
}

async function deleteAudioFile(id: string) {
  await dynamo.send(new DeleteItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: id } },
  }));
  return respond(204, null);
}

// --- Tags ---

async function addTag(audioFileId: string, event: APIGatewayProxyEventV2) {
  const { name } = JSON.parse(event.body || "{}");

  await dynamo.send(new UpdateItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    UpdateExpression: "SET tags = list_append(if_not_exists(tags, :empty), :tag)",
    ConditionExpression: "NOT contains(tags, :tagVal)",
    ExpressionAttributeValues: {
      ":tag": { L: [{ S: name }] },
      ":empty": { L: [] },
      ":tagVal": { S: name },
    },
  })).catch(err => {
    // Ignore ConditionalCheckFailedException — tag already exists
    if (err.name !== "ConditionalCheckFailedException") throw err;
  });

  return respond(201, { name });
}

async function getTags(audioFileId: string) {
  const result = await dynamo.send(new GetItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    ProjectionExpression: "tags",
  }));

  const tags = result.Item?.tags?.L?.map((t: any) => t.S) || [];
  return respond(200, tags);
}

async function removeTag(audioFileId: string, event: APIGatewayProxyEventV2) {
  const { name } = JSON.parse(event.body || "{}");

  // Get current tags, remove the one, write back
  const result = await dynamo.send(new GetItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    ProjectionExpression: "tags",
  }));

  const currentTags = result.Item?.tags?.L?.map((t: any) => t.S) || [];
  const newTags = currentTags.filter((t: string) => t !== name);

  await dynamo.send(new UpdateItemCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
    Key: { id: { S: audioFileId } },
    UpdateExpression: "SET tags = :tags",
    ExpressionAttributeValues: {
      ":tags": { L: newTags.map((t: string) => ({ S: t })) },
    },
  }));

  return respond(204, null);
}

// --- Comments ---

async function getComments(audioFileId: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName: process.env.COMMENTS_TABLE,
    KeyConditionExpression: "audio_file_id = :id",
    ExpressionAttributeValues: {
      ":id": { S: audioFileId },
    },
    ScanIndexForward: true,  // Oldest first
  }));

  return respond(200, (result.Items || []).map(fromDynamo));
}

async function addComment(audioFileId: string, event: APIGatewayProxyEventV2) {
  const body = JSON.parse(event.body || "{}");
  const createdAt = new Date().toISOString();
  const id = randomUUID();

  await dynamo.send(new PutItemCommand({
    TableName: process.env.COMMENTS_TABLE,
    Item: {
      audio_file_id: { S: audioFileId },
      created_at: { S: createdAt },
      id: { S: id },
      user_id: { S: body.user_id },
      content: { S: body.content },
    },
  }));

  return respond(201, {
    id, audio_file_id: audioFileId,
    user_id: body.user_id, content: body.content,
    created_at: createdAt,
  });
}

// --- Upload URL (S3) ---

async function getUploadUrl(event: APIGatewayProxyEventV2) {
  const { filename, contentType } = JSON.parse(event.body || "{}");
  const key = `uploads/${Date.now()}-${filename}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AUDIO_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return respond(200, {
    uploadUrl,
    fileUrl: `https://${process.env.AUDIO_BUCKET}.s3.amazonaws.com/${key}`,
  });
}

// --- Reactions (unchanged from Phase 2) ---

async function addReaction(audioFileId: string, event: APIGatewayProxyEventV2) {
  const { user_id, reaction_type } = JSON.parse(event.body || "{}");

  await dynamo.send(new PutItemCommand({
    TableName: process.env.REACTIONS_TABLE,
    Item: {
      audio_file_id: { S: audioFileId },
      user_id: { S: user_id },
      reaction_type: { S: reaction_type },
      created_at: { S: new Date().toISOString() },
    },
  }));

  return respond(201, { audio_file_id: audioFileId, user_id, reaction_type });
}

async function getReactions(audioFileId: string) {
  const result = await dynamo.send(new QueryCommand({
    TableName: process.env.REACTIONS_TABLE,
    KeyConditionExpression: "audio_file_id = :id",
    ExpressionAttributeValues: {
      ":id": { S: audioFileId },
    },
  }));

  return respond(200, (result.Items || []).map(fromDynamo));
}

async function removeReaction(audioFileId: string, event: APIGatewayProxyEventV2) {
  const { user_id } = JSON.parse(event.body || "{}");

  await dynamo.send(new DeleteItemCommand({
    TableName: process.env.REACTIONS_TABLE,
    Key: {
      audio_file_id: { S: audioFileId },
      user_id: { S: user_id },
    },
  }));

  return respond(204, null);
}

// --- Router ---

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method === "OPTIONS") return respond(200, {});

  try {
    // Audio files
    if (path === "/audio" && method === "GET") return await listAudioFiles(event);
    if (path === "/audio" && method === "POST") return await createAudioFile(event);
    if (path === "/tags" && method === "GET") return await listAllTags();

    const audioMatch = path.match(/^\/audio\/([^/]+)$/);
    if (audioMatch) {
      const id = audioMatch[1];
      if (method === "GET") return await getAudioFile(id);
      if (method === "PUT") return await updateAudioFile(id, event);
      if (method === "DELETE") return await deleteAudioFile(id);
    }

    // Tags
    const tagsMatch = path.match(/^\/audio\/([^/]+)\/tags$/);
    if (tagsMatch) {
      const id = tagsMatch[1];
      if (method === "GET") return await getTags(id);
      if (method === "POST") return await addTag(id, event);
      if (method === "DELETE") return await removeTag(id, event);
    }

    // Comments
    const commentsMatch = path.match(/^\/audio\/([^/]+)\/comments$/);
    if (commentsMatch) {
      const id = commentsMatch[1];
      if (method === "GET") return await getComments(id);
      if (method === "POST") return await addComment(id, event);
    }

    // Upload URL
    if (path === "/upload-url" && method === "POST") return await getUploadUrl(event);

    // Reactions
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