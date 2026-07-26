import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface EdgeConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class EdgeWriter {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: EdgeConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async putJson(key: string, value: unknown, cacheSeconds: number): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        CacheControl: `public, max-age=${cacheSeconds}`,
      }),
    );
  }

  async getJson(key: string): Promise<unknown | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const text = await res.Body?.transformToString();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
}
