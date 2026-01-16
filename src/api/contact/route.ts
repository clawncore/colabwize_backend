import { ContactService } from "../../services/contactService";
import { getSafeString } from "../../utils/requestHelpers";

// POST /api/contact - Handle contact form submission
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;

    const name = getSafeString(body.name);
    const email = getSafeString(body.email);
    const subject = getSafeString(body.subject);
    const message = getSafeString(body.message);

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({
          error: "All fields are required: name, email, subject, message",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get IP address and user agent from request
    const ip_address =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const user_agent = request.headers.get("user-agent") || "unknown";

    // Process the contact form submission
    const result = await ContactService.handleContactSubmission({
      name: name!,
      email: email!,
      subject: subject!,
      message: message!,
      ip_address,
      user_agent,
    });

    return new Response(
      JSON.stringify({
        message: "Your message has been sent successfully",
        result,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error processing contact form:", error);

    return new Response(
      JSON.stringify({
        error: error.message || "Failed to process contact form submission",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
