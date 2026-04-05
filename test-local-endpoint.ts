import * as dotenv from "dotenv";
dotenv.config();

const run = async () => {
  try {
    const res = await fetch("http://localhost:3001/api/google-drive/list?folderId=root", {
      headers: {
        "X-Auth-Google": `Bearer ${process.env.TEST_TOKEN || "test"}`, 
        // We'll skip auth and see if it hits our code, wait, hybrid auth requires a true token!
        // I'll grab a real token by authenticating or I can just simulate it.
        // Actually, let me just check the backend terminal output!
      }
    });
    console.log(res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
}
run();
