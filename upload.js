// Netlify serverless function to handle file uploads and commit to GitHub
const GITHUB_REPO = "scammedbynate/help";
const GITHUB_BRANCH = "main";

exports.handler = async (event) => {
  // CORS headers for all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  // Handle CORS preflight request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Check for GitHub token
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return {
      statusCode: 500,
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Server configuration error: Missing GitHub token",
      }),
    };
  }

  try {
    // Parse the multipart form data
    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"];

    if (!contentType || !contentType.includes("application/json")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Content-Type must be application/json",
        }),
      };
    }

    const data = JSON.parse(event.body);
    const { fileName, fileContent, fileType } = data;

    if (!fileName || !fileContent || !fileType) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing required fields: fileName, fileContent, fileType",
        }),
      };
    }

    // Validate file type
    const allowedImageTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
    ];
    const allowedVideoTypes = [
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/mov",
    ];
    const isImage = allowedImageTypes.includes(fileType);
    const isVideo =
      allowedVideoTypes.includes(fileType) ||
      fileName.toLowerCase().endsWith(".mov");

    if (!isImage && !isVideo) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error:
            "Invalid file type. Only images (PNG, JPG, GIF, WebP) and videos (MP4, MOV, WebM) are allowed.",
        }),
      };
    }

    // Generate unique filename to avoid conflicts
    const timestamp = Date.now();
    const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueFileName = `upload_${timestamp}_${cleanName}`;

    // Step 1: Upload the file to GitHub
    const uploadResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${uniqueFileName}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          message: `Add evidence: ${uniqueFileName}`,
          content: fileContent, // Already base64 encoded from client
          branch: GITHUB_BRANCH,
        }),
      }
    );

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.text();
      console.error("GitHub upload error:", errorData);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Failed to upload file to GitHub",
          details: errorData,
        }),
      };
    }

    // Step 2: Get current manifest
    const manifestResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/gallery-manifest.json`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    let manifest = { images: [], videos: [] };
    let manifestSha = null;

    if (manifestResponse.ok) {
      const manifestData = await manifestResponse.json();
      manifestSha = manifestData.sha;
      const manifestContent = Buffer.from(
        manifestData.content,
        "base64"
      ).toString("utf8");
      manifest = JSON.parse(manifestContent);
    }

    // Step 3: Update manifest with new file
    if (isImage) {
      manifest.images.push(uniqueFileName);
    } else if (isVideo) {
      manifest.videos.push(uniqueFileName);
    }

    // Step 4: Commit updated manifest
    const manifestUpdateResponse = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/gallery-manifest.json`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          message: `Update gallery manifest: add ${uniqueFileName}`,
          content: Buffer.from(JSON.stringify(manifest, null, 2)).toString(
            "base64"
          ),
          sha: manifestSha,
          branch: GITHUB_BRANCH,
        }),
      }
    );

    if (!manifestUpdateResponse.ok) {
      const errorData = await manifestUpdateResponse.text();
      console.error("Manifest update error:", errorData);
      // File was uploaded but manifest wasn't updated - still partial success
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          fileName: uniqueFileName,
          warning:
            "File uploaded but gallery manifest update failed. File will appear after manual refresh.",
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        fileName: uniqueFileName,
        message:
          "Evidence uploaded successfully! It will appear in the gallery shortly.",
      }),
    };
  } catch (error) {
    console.error("Upload error:", error);
    return {
      statusCode: 500,
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
    };
  }
};
