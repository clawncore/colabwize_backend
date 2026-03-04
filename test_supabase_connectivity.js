const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

async function testSupabase() {
  console.log("Testing Supabase connectivity...");
  console.log("URL:", supabaseUrl);

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const start = Date.now();
  try {
    // Just a simple query to a common table or health check
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .limit(1);
    const duration = Date.now() - start;

    if (error) {
      console.error("Supabase error:", error.message);
    } else {
      console.log("Supabase check successful in " + duration + "ms");
      console.log("Data:", data);
    }
  } catch (err) {
    console.error("Failed to connect to Supabase:", err.message);
  }
}

testSupabase();
