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
const BUCKET_PRODUCTION = "jn-foo-production";
const BUCKET_STAGING = "jn-foo-staging";
const BUCKET_DEVELOPMENT = "jn-foo-development";

const getServerEnv = (bucket) => {
  let API_URL = "";
  let ACCESS_TOKEN = "";

  switch (bucket) {
    case BUCKET_PRODUCTION:
      API_URL = process.env.API_URL_PROD;
      ACCESS_TOKEN = process.env.ACCESS_TOKEN_PROD;
      break;
    case BUCKET_STAGING:
      API_URL = process.env.API_URL_STAGING;
      ACCESS_TOKEN = process.env.ACCESS_TOKEN_STAGING;
      break;
    case BUCKET_DEVELOPMENT:
      API_URL = process.env.API_URL_DEV;
      ACCESS_TOKEN = process.env.ACCESS_TOKEN_DEV;
      break;
    default:
      break;
  }

  return { API_URL, ACCESS_TOKEN };
};

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
    const splitFilepath = key.split("/");
    const filenameWithExtension = splitFilepath[splitFilepath.length - 1];
    const filename = filenameWithExtension.split(".")[0];
    const imageExtensionsRegex = /\.(jpg|jpeg|png|gif|svg)$/i;
    const isImage = imageExtensionsRegex.test(filenameWithExtension);

    if (!isImage) {
      console.log(
        "object is not supported to resize: filename",
        filenameWithExtension
      );
      return;
    }

    const buffer = await new Promise((resolve, reject) => {
      const chunks = [];

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.once("end", () => resolve(Buffer.concat(chunks)));
      stream.once("error", reject);
    });

    const smallImageBuffer = await sharp(buffer)
      .resize(350)
      .jpeg({ quality: 25 })
      .toBuffer();
    const smallFilename = `small-${filename}.jpeg`;
    const smallImageKey = `places/small/${smallFilename}`;
    const putSmallImageCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: smallImageKey,
      Body: smallImageBuffer,
    });

    const mediumImageBuffer = await sharp(buffer)
      .resize(650)
      .jpeg({ quality: 60 })
      .toBuffer();
    const mediumFilename = `medium-${filename}.jpeg`;
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

    const { API_URL, ACCESS_TOKEN } = getServerEnv(bucket);

    // update meta data
    await axios({
      method: "PATCH",
      url: `${API_URL}/place-photos/metadata`,
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      data: {
        originalFilename: filenameWithExtension,
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
