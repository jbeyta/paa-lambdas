import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const dynamo = new DynamoDBClient({});
const ses = new SESClient({});

function fromDynamo(item: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== undefined) result[key] = value.S;
    else if (value.N !== undefined) result[key] = Number(value.N);
    else if (value.L) result[key] = value.L.map((v: any) => v.S || v.N || v);
  }
  return result;
}

export const handler = async () => {
  // Get all audio files
  const result = await dynamo.send(new ScanCommand({
    TableName: process.env.AUDIO_FILES_TABLE,
  }));

  const files = (result.Items || []).map(fromDynamo);

  if (files.length === 0) {
    console.error("No files found");
    return { statusCode: 500, body: "No files available" };
  }

  // Pick a random one
  const clip = files[Math.floor(Math.random() * files.length)];
  const appUrl = process.env.APP_URL;

  const emailBody = `
    <h2>🎵 Clip of the Day</h2>
    <p><strong>${clip.title}</strong></p>
    ${clip.description ? `<p>${clip.description}</p>` : ""}
    <p>Uploaded: ${new Date(clip.created_at).toLocaleDateString()}</p>
    <p><a href="${appUrl}/audio/${clip.id}">Listen now →</a></p>
    <br>
    <p style="color: #666; font-size: 12px;">
      Keep your ideas fresh — one clip at a time.
    </p>
  `;

  await ses.send(new SendEmailCommand({
    Source: process.env.FROM_EMAIL!,
    Destination: {
      ToAddresses: [process.env.TO_EMAIL!],
    },
    Message: {
      Subject: { Data: `🎵 Clip of the Day: ${clip.title}` },
      Body: {
        Html: { Data: emailBody },
      },
    },
  }));

  console.log(`Sent Clip of the Day: ${clip.title} (${clip.id})`);
  return { statusCode: 200, body: `Sent: ${clip.title}` };
};