import dotenv from "dotenv";

console.log("Cwd saat ini:", process.cwd());
const result = dotenv.config();
console.log("Dotenv config result:", result.error ? "Error: " + result.error.message : "Success");
console.log("FACEBOOK_UPLOAD_ENABLED:", process.env.FACEBOOK_UPLOAD_ENABLED);
console.log("DUNIALUAS_FACEBOOK_PAGE_ID:", process.env.DUNIALUAS_FACEBOOK_PAGE_ID);
console.log("INSTAGRAM_UPLOAD_ENABLED:", process.env.INSTAGRAM_UPLOAD_ENABLED);
