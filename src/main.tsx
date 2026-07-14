import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./lib/monaco";
import "./styles/tokens.css";
import "../../elatic_min/src/styles/themes.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/requestsmin.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
