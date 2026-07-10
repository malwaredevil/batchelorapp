import { createRoot } from "react-dom/client";
import { installScreenshotImageAutoAuth } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

installScreenshotImageAutoAuth();
createRoot(document.getElementById("root")!).render(<App />);
