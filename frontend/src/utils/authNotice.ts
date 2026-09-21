import { showAppAlert } from "./alertConfig";

type NoticeType = "success" | "error";

function normalizeNoticeText(text: string, type: NoticeType) {
  const value = String(text ?? "").trim();

  if (!value) {
    return type === "success"
      ? "Action completed successfully."
      : "Something went wrong. Please try again.";
  }

  const cleaned = value
    .replace(/auth_code\s*[:=][^,\n]+/gi, "")
    .replace(/code_verifier\s*[:=][^,\n]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/,$/, "")
    .trimEnd();

  if (!cleaned || /auth_code|code_verifier/i.test(value)) {
    return type === "success"
      ? "Google login successful."
      : "Authentication failed. Please try again.";
  }

  return cleaned;
}

export function showAuthNotice(text: string, type: NoticeType = "success") {
  const nextText = normalizeNoticeText(text, type);
  sessionStorage.setItem("auth_notice", JSON.stringify({ text: nextText, type }));

  return showAppAlert({
    title: type === "success" ? "Success" : "Error",
    text: nextText,
    type,
    timer: 2400,
  });
}
