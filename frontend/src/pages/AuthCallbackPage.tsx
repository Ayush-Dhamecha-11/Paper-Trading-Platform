// import { useEffect } from "react";
// import { useNavigate } from "react-router-dom";

// export default function AuthCallbackPage() {
//   const navigate = useNavigate();

//   useEffect(() => {
//     const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";

//     if (!hash) {
//       navigate("/login", { replace: true });
//       return;
//     }

//     const params = new URLSearchParams(hash);
//     const accessToken = params.get("access_token");
//     const refreshToken = params.get("refresh_token");
//     const error = params.get("error");
//     const errorCode = params.get("error_code");
//     const errorDescription = params.get("error_description");

//     const cleanUrl = new URL(window.location.href);
//     cleanUrl.hash = "";
//     window.history.replaceState({}, "", cleanUrl.toString());

//     if (accessToken) {
//       localStorage.setItem("auth_token", accessToken);

//       if (refreshToken) {
//         localStorage.setItem("refresh_token", refreshToken);
//       }

//       window.sessionStorage.setItem(
//         "auth_notice",
//         JSON.stringify({
//           text: "Account created successfully.",
//           type: "success",
//         })
//       );

//       window.dispatchEvent(new CustomEvent("auth-success"));
//       navigate("/dashboard", { replace: true });
//       return;
//     }

//     const message =
//       decodeURIComponent(errorDescription || "") ||
//       error ||
//       errorCode ||
//       "Authentication failed. Please login again.";

//     window.sessionStorage.setItem(
//       "auth_notice",
//       JSON.stringify({
//         text: message,
//         type: "error",
//       })
//     );

//     navigate("/login", { replace: true });
//   }, [navigate]);

//   return (
//     <div
//       style={{
//         minHeight: "100vh",
//         display: "flex",
//         alignItems: "center",
//         justifyContent: "center",
//         color: "#e5e7eb",
//         background: "#0b1220",
//         fontSize: "1rem",
//         fontWeight: 600,
//       }}
//     >
//       Processing authentication...
//     </div>
//   );
// }
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.BACKEND_URL ||
    "http://localhost:8000"
).replace(/\/$/, "");

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const processAuthentication = async () => {
      try {
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : "";

        if (!hash) {
          navigate("/login", { replace: true });
          return;
        }

        const params = new URLSearchParams(hash);

        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        const error = params.get("error");
        const errorCode = params.get("error_code");
        const errorDescription =
          params.get("error_description");

        const cleanUrl = new URL(window.location.href);
        cleanUrl.hash = "";
        window.history.replaceState(
          {},
          "",
          cleanUrl.toString()
        );

        if (error || errorCode || errorDescription) {
          const message =
            errorDescription ||
            error ||
            errorCode ||
            "Authentication failed. Please try again.";

          window.sessionStorage.setItem(
            "auth_notice",
            JSON.stringify({
              text: decodeURIComponent(message),
              type: "error",
            })
          );

          navigate("/login", { replace: true });
          return;
        }

        if (!accessToken || !refreshToken) {
          window.sessionStorage.setItem(
            "auth_notice",
            JSON.stringify({
              text: "Authentication failed. Please try again.",
              type: "error",
            })
          );

          navigate("/login", { replace: true });
          return;
        }

        const response = await fetch(
          `${backendBaseUrl}/auth/register/callback`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              access_token: accessToken,
              refresh_token: refreshToken,
            }),
          }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.detail ||
              data.message ||
              "Authentication failed. Please try again."
          );
        }

        window.sessionStorage.setItem(
          "auth_notice",
          JSON.stringify({
            text:
              data.message ||
              "Account created successfully.",
            type: "success",
          })
        );

        window.dispatchEvent(
          new CustomEvent("auth-success")
        );

        navigate("/dashboard", { replace: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Authentication failed. Please try again.";

        window.sessionStorage.setItem(
          "auth_notice",
          JSON.stringify({
            text: message,
            type: "error",
          })
        );

        navigate("/login", { replace: true });
      }
    };

    void processAuthentication();
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#e5e7eb",
        background: "#0b1220",
        fontSize: "1rem",
        fontWeight: 600,
      }}
    >
      Processing authentication...
    </div>
  );
}