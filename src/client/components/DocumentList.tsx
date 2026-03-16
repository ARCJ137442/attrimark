import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEditorStore } from "../store";
import * as api from "../api";

export function DocumentList() {
  const { documents, loadDocuments } = useEditorStore();
  const [title, setTitle] = useState("");
  const [filePath, setFilePath] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadDocuments();
  }, []);

  const navToDoc = (path: string) => navigate(`/doc?path=${encodeURIComponent(path)}`);

  const handleCreate = async () => {
    if (!title.trim() || !filePath.trim()) return;
    let path = filePath.trim();
    if (!path.endsWith(".attrimark")) path += ".attrimark";
    const doc = await api.createDocument(title.trim(), path);
    setTitle("");
    setFilePath("");
    setShowCreate(false);
    navToDoc(doc.path);
  };

  const handleDelete = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个文档吗？")) return;
    await api.deleteDocument(path);
    loadDocuments();
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const source = prompt("内容来源？输入 human 或 agent", "human");
    if (source !== "human" && source !== "agent") return;
    const outputPath = prompt("保存路径（.attrimark 文件）", file.name.replace(/\.(md|markdown|txt)$/, ".attrimark"));
    if (!outputPath) return;

    const doc = await api.importDocument(text, outputPath, source);
    setShowImport(false);
    navToDoc(doc.path);
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1><img src="/logo.svg" alt="Attrimark" className="logo-icon" /> Attrimark</h1>
        <p className="subtitle">AI 内容溯源编辑器</p>
      </header>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + 新建文档
        </button>
        <button className="btn" onClick={() => setShowImport(true)}>
          导入 Markdown
        </button>
      </div>

      {showCreate && (
        <div className="dialog-overlay" onClick={() => setShowCreate(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>新建文档</h3>
            <input
              type="text"
              placeholder="文档标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              placeholder="文件路径（如 docs/my-doc.attrimark）"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              style={{ marginTop: 8 }}
            />
            <div className="dialog-actions">
              <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="dialog-overlay" onClick={() => setShowImport(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>导入 Markdown</h3>
            <input
              type="file"
              accept=".md,.markdown,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
              }}
            />
            <div className="dialog-actions">
              <button className="btn" onClick={() => setShowImport(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      <div className="doc-grid">
        {documents.map((doc) => (
          <div key={doc.path} className="doc-card" onClick={() => navToDoc(doc.path)}>
            <h3>{doc.title}</h3>
            <span className="doc-date">{new Date(doc.updatedAt).toLocaleDateString("zh-CN")}</span>
            <button className="btn-icon btn-delete" onClick={(e) => handleDelete(doc.path, e)} title="删除">
              &times;
            </button>
          </div>
        ))}
        {documents.length === 0 && (
          <p className="empty-state">还没有文档，点击"新建文档"开始</p>
        )}
      </div>
    </div>
  );
}
