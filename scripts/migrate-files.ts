import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const supabase = createClient(
  "https://oqsxgdobsgyhigcbmnrl.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xc3hnZG9ic2d5aGlnY2JtbnJsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODMzNzExNCwiZXhwIjoyMDgzOTEzMTE0fQ.f3OIw_71IbVUhOrvXYksbwzI6Dd1UkBEqtZaMcD9wto"
);

const s3 = new S3Client({ region: "us-east-1" });
const BUCKET = "gromulax-paa-audio-files";

async function migrate() {
  const { data: files, error } = await supabase.storage
    .from("audio")
    .list();

  if (error || !files) {
    console.error("Failed to list files:", error);
    return;
  }

  const urlMappings: { id: string; newUrl: string }[] = [];

  for (const file of files) {
    console.log(`Migrating: ${file.name}`);

    const { data, error: dlError } = await supabase.storage
      .from("audio")
      .download(file.name);

    if (dlError || !data) {
      console.error(`Failed to download ${file.name}:`, dlError);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const key = `uploads/${file.name}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: data.type,
    }));

    const newUrl = `https://${BUCKET}.s3.amazonaws.com/${key}`;
    console.log(`Uploaded to S3: ${newUrl}`);
  }

  console.log("File migration complete!");
  console.log("Now update the file_url for each record in DynamoDB.");
}

migrate();