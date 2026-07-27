
import "video.js/dist/video-js.css";



export default function EndPage() {
  return (
    <div
      className="container py-5"
      style={{ overflowY: "auto", height: "100vh" }}
    >
      <h3> You completed the study🎉</h3>
      <p> Thank you for participating and helping us to evaluate this serious game prototype! </p>
      <p> Please refrain from participating again with another username as this would invalidate our results. </p>
    </div>
  );
}
