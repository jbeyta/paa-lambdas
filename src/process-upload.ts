import { SQSEvent } from "aws-lambda";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

interface UploadMessage {
  audioFileId: string;
  s3Key: string;
}

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const message: UploadMessage = JSON.parse(record.body);
    console.log(`Processing upload: ${message.audioFileId}`);

    try {
      const head = await s3.send(new HeadObjectCommand({
        Bucket: process.env.AUDIO_BUCKET,
        Key: message.s3Key,
      }));

      await dynamo.send(new UpdateItemCommand({
        TableName: process.env.AUDIO_FILES_TABLE,
        Key: { id: { S: message.audioFileId } },
        UpdateExpression: "SET file_size = :size, content_type = :type",
        ExpressionAttributeValues: {
          ":size": { N: (head.ContentLength || 0).toString() },
          ":type": { S: head.ContentType || "unknown" },
        },
      }));

      console.log(`Processed: ${message.audioFileId}`);
    } catch (err) {
      console.error(`Error processing ${message.audioFileId}:`, err);
      throw err;
    }
  }
};