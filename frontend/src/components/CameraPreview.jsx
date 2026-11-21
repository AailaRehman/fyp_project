import { useEffect, useRef } from "react";

export default function CameraPreview({ stream, status, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  const on = status === "on";
  return (
    <div className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-line ${className}`}>
      <video ref={ref} autoPlay muted playsInline aria-label="Your camera" className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
      {!stream && <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted">Your camera will appear here</p>}
      <p className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-bg/80 px-2 py-1 text-xs text-ink">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${on ? "bg-danger" : "bg-muted"}`} />
        {on ? "Camera on" : "Camera off"}
      </p>
    </div>
  );
}
