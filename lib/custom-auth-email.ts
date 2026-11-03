export type CustomAuthEmailType = "reset" | "verify";

export async function sendCustomAuthEmail(
  email: string,
  type: CustomAuthEmailType,
) {
  const response = await fetch("/api/auth/send-mail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, type }),
  });

  let result: { message?: string; error?: string };
  try {
    result = (await response.json()) as { message?: string; error?: string };
  } catch {
    throw new Error("Email service returned an invalid response. Please try again later.");
  }

  if (!response.ok) {
    throw new Error(result.error || "The email could not be sent. Please try again later.");
  }

  return result;
}
