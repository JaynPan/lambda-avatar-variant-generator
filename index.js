const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const axios = require("axios");

const s3 = new S3Client({
  region: "ap-northeast-3",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

exports.handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(
    event.Records[0].s3.object.key.replace(/\+/g, " ")
  );

  console.log("bucket", bucket);
  console.log("object key", key);

  try {
    const getObjectCommand = new GetObjectCommand({
      Key: key,
      Bucket: bucket,
    });
    const response = await s3.send(getObjectCommand);
    const stream = response.Body;
    const filename = key.split("/")[2];
    const imageExtensionsRegex = /\.(jpg|jpeg|png|gif|bmp|svg|heic)$/i;
    const isImage = imageExtensionsRegex.test(filename);

    if (!isImage) {
      console.log("object is not an image: filename", filename);
      return;
    }

    const buffer = await new Promise((resolve, reject) => {
      const chunks = [];

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.once("end", () => resolve(Buffer.concat(chunks)));
      stream.once("error", reject);
    });

    const smallImageBuffer = await sharp(buffer).resize(400).toBuffer();
    const smallFilename = `small-${filename}`;
    const smallImageKey = `places/small/${smallFilename}`;
    const putSmallImageCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: smallImageKey,
      Body: smallImageBuffer,
    });

    const mediumImageBuffer = await sharp(buffer).resize(700).toBuffer();
    const mediumFilename = `medium-${filename}`;
    const mediumImageKey = `places/medium/${mediumFilename}`;
    const putMediumImageCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: mediumImageKey,
      Body: mediumImageBuffer,
    });

    await Promise.all([
      s3.send(putSmallImageCommand),
      s3.send(putMediumImageCommand),
    ]);

    console.log("Variant images created and upload to S3 successfully!");

    // update meta data
    await axios({
      method: "PATCH",
      url: `${process.env.API_URL}/place-photos/metadata`,
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
      },
      data: {
        originalFilename: filename,
        mediumFilename,
        smallFilename,
      },
    });

    console.log("update metadata successfully!");
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      body: "Error processing the image.",
    };
  }
};
