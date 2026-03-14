import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEditorStore } from "../store";
import * as api from "../api";

export function DocumentList() {
  const { documents, loadDocuments } = useEditorStore();
  const [title, setTitle] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    const doc = await api.createDocument(title.trim());
    setTitle("");
    setShowCreate(false);
    navigate(`/doc/${doc.id}`);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个文档吗？")) return;
    await api.deleteDocument(id);
    loadDocuments();
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    let provenance: any;

    // Check if there's a corresponding .provenance.json
    const baseName = file.name.replace(/\.md$/, "");
    // Can't auto-detect provenance file in browser, just import as-is
    const source = prompt("内容来源？输入 human 或 agent", "human");
    if (source !== "human" && source !== "agent") return;

    const doc = await api.importDocument(text, source, provenance);
    setShowImport(false);
    navigate(`/doc/${doc.id}`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Provenance Editor</h1>
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
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
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
          <div key={doc.id} className="doc-card" onClick={() => navigate(`/doc/${doc.id}`)}>
            <h3>{doc.title}</h3>
            <span className="doc-date">{new Date(doc.updatedAt).toLocaleDateString("zh-CN")}</span>
            <button className="btn-icon btn-delete" onClick={(e) => handleDelete(doc.id, e)} title="删除">
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
