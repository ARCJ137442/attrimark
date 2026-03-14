import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DocumentList } from "./components/DocumentList";
import { DocumentEditor } from "./components/DocumentEditor";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DocumentList />} />
        <Route path="/doc/:id" element={<DocumentEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
