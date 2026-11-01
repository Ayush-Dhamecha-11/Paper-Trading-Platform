import Swal from "sweetalert2";

export const showAppAlert = ({
  title,
  text,
  type = "success",
  confirmButtonText = "OK",
  timer = 0,
}: {
  title: string;
  text?: string;
  type?: "success" | "error" | "warning" | "info";
  confirmButtonText?: string;
  timer?: number;
}) => {
  const isSuccess = type === "success";

  return Swal.fire({
    title,
    text,
    icon: type,
    confirmButtonText,
    timer,
    timerProgressBar: Boolean(timer),
    background: "#0b1a2a",
    color: "#f5fbff",
    confirmButtonColor: isSuccess ? "#1ecf9a" : "#f87171",
    cancelButtonColor: "#1e293b",
    width: "min(92vw, 28rem)",
    customClass: {
      popup: "app-alert-popup",
      title: "app-alert-title",
      confirmButton: "app-alert-confirm-btn",
    },
    buttonsStyling: false,
    showClass: {
      popup: "swal2-show",
    },
    hideClass: {
      popup: "swal2-hide",
    },
  });
};
