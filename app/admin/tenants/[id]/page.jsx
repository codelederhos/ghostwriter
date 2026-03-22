"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { Save, Play, ArrowLeft, Trash2, GripVertical, Plus, ChevronDown, ChevronRight, FlaskConical, Shuffle, X, Timer, Download, Copy, Check, MapPin, Building2, Home, ChevronLeft, ExternalLink } from "lucide-react";
import ImageModal from "./ImageModal";
import AddressAutocomplete from "./AddressAutocomplete";
import Link from "next/link";
import { fmtMs } from "@/lib/utils/format";

const DEFAULT_ANGLES = [
  { key: 1, label: "Zahlenfakt / Rechenbeispiel", active: true },
  { key: 2, label: "Kundenperspektive / Testimonial", active: true },
  { key: 3, label: "FAQ / Frage-Antwort", active: true },
  { key: 4, label: "Vergleich / Andere vs. Wir", active: true },
  { key: 5, label: "Tipp / Actionable Advice", active: true },
];

export default function TenantDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [tenant, setTenant] = useState(null);
  const [settings, setSettings] = useState({});
  const [profile, setProfile] = useState({});
  const [topics, setTopics] = useState([]);
  const [tab, setTab] = useState("profile");
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: "", name: "", password: "" });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editUserData, setEditUserData] = useState({ email: "", name: "", password: "" });
  const [hoveredDeleteUserId, setHoveredDeleteUserId] = useState(null);
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [dragItem, setDragItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [hoverDelete, setHoverDelete] = useState(null); // { type: "cat"|"angle", catIdx, angleIdx? }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type, catIdx, angleIdx?, label }
  const [lastDeleteAt, setLastDeleteAt] = useState(0); // 3s-Regel Timer
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success"); // "success" | "error"
  const [refImages, setRefImages] = useState({ persona: [], post: [] });
  const [tenantPosts, setTenantPosts] = useState(null);
  const [postPreview, setPostPreview] = useState(null);
  const [billingData, setBillingData] = useState(null);
  const [invoiceStart, setInvoiceStart] = useState("");
  const [invoiceEnd, setInvoiceEnd] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testMode, setTestMode] = useState("random"); // "random" | "manual"
  const [testCatIdx, setTestCatIdx] = useState(0);
  const [testAngleIdx, setTestAngleIdx] = useState(0);
  const [testRunning, setTestRunning] = useState(false);
  const [testStep, setTestStep] = useState(0);
  const [testResult, setTestResult] = useState(null);
  const [testStartTime, setTestStartTime] = useState(null);
  const [testElapsedMs, setTestElapsedMs] = useState(0);
  const [modelLabels, setModelLabels] = useState({});
  const [sysPricing, setSysPricing] = useState({ post_price_cents: 300, refresh_discount_percent: 40 });
  const [dotPhase, setDotPhase] = useState(0);
  const [displayTotal, setDisplayTotal] = useState(0);
  const [regenModal, setRegenModal] = useState(null); // { postId, postTitle, imageUrl, regenPrice }
  const [regenLoading, setRegenLoading] = useState(false);
  const [exportModal, setExportModal] = useState(null); // { postId, postTitle, upgradeCents, fullPriceCents }
  const pollRef = useRef(null);
  const displayTotalRef = useRef(0);
  const [googleStatus, setGoogleStatus] = useState(null); // null | { connected, ... }
  const [googleLoading, setGoogleLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [gbpPostLoading, setGbpPostLoading] = useState(null); // postId or null
  const [visionStatus, setVisionStatus] = useState("idle"); // idle | running | done
  const [visionAnalyzed, setVisionAnalyzed] = useState(0);
  const [visionTotal, setVisionTotal] = useState(0);
  const visionPollRef = useRef(null);
  const [selectedImageIdx, setSelectedImageIdx] = useState(null); // null = modal closed
  const [properties, setProperties] = useState([]);
  const [showNewProperty, setShowNewProperty] = useState(false);
  const [newProp, setNewProp] = useState({ name: "", address: "", lat: null, lng: null, type: "haus", parent_id: "" });
  const [propSaving, setPropSaving] = useState(false);
  const [expandedProps, setExpandedProps] = useState(new Set());
  const [selectedImages, setSelectedImages] = useState(new Set()); // multi-select
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const confirmDeleteTimerRef = useRef(null);
  const [hoveredDeleteId, setHoveredDeleteId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const bulkDeleteTimerRef = useRef(null);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [showBulkTagInput, setShowBulkTagInput] = useState(false); // "add" | "remove" | false
  const [filterProperty, setFilterProperty] = useState(null); // null = alle
  const [filterCondition, setFilterCondition] = useState(null); // null = alle

  function showMsg(text, type = "success") {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), type === "error" ? 8000 : 4000);
  }

  useEffect(() => { loadTenant(); loadModelLabels(); loadBilling(); loadTenantPosts(); loadRefImages(); loadGoogleStatus(); loadAnalyzeStatus(); loadProperties(); }, [id]);

  // Google Tab: URL-Param nach OAuth-Callback + Status laden
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("tab") === "google") {
      setTab("google");
      if (p.get("google_connected")) showMsg("Google erfolgreich verbunden ✓");
      if (p.get("google_error")) showMsg(`Google Fehler: ${p.get("google_error")}`, "error");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const syncPollRef = useRef(null);

  // Sync-Polling starten wenn running
  useEffect(() => {
    if (googleStatus?.syncStatus === "running") {
      if (syncPollRef.current) return; // bereits läuft
      syncPollRef.current = setInterval(async () => {
        const res = await fetch(`/api/tenants/${id}/google`);
        const data = await res.json();
        setGoogleStatus(data);
        if (data.syncStatus !== "running") {
          clearInterval(syncPollRef.current);
          syncPollRef.current = null;
          loadRefImages(); // Bilder-Liste aktualisieren
        }
      }, 1200);
    } else {
      if (syncPollRef.current) {
        clearInterval(syncPollRef.current);
        syncPollRef.current = null;
      }
    }
    return () => {
      if (syncPollRef.current) { clearInterval(syncPollRef.current); syncPollRef.current = null; }
    };
  }, [googleStatus?.syncStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vision-Analyse Polling
  useEffect(() => {
    if (visionStatus === "running") {
      if (visionPollRef.current) return;
      visionPollRef.current = setInterval(async () => {
        const res = await fetch(`/api/tenants/${id}/images/analyze`);
        const data = await res.json();
        setVisionAnalyzed(data.analyzed || 0);
        setVisionTotal(data.total || 0);
        if (data.status !== "analyzing") {
          setVisionStatus(data.status === "done" ? "done" : "idle");
          clearInterval(visionPollRef.current);
          visionPollRef.current = null;
          loadRefImages();
        }
      }, 1500);
    } else {
      if (visionPollRef.current) { clearInterval(visionPollRef.current); visionPollRef.current = null; }
    }
    return () => { if (visionPollRef.current) { clearInterval(visionPollRef.current); visionPollRef.current = null; } };
  }, [visionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadGoogleStatus() {
    setGoogleLoading(true);
    try {
      const res = await fetch(`/api/tenants/${id}/google`);
      setGoogleStatus(await res.json());
    } catch { setGoogleStatus({ connected: false }); }
    setGoogleLoading(false);
  }

  async function loadAnalyzeStatus() {
    try {
      const res = await fetch(`/api/tenants/${id}/images/analyze`);
      if (!res.ok) return;
      const data = await res.json();
      setVisionStatus(data.status === "analyzing" ? "running" : (data.status || "idle"));
      setVisionAnalyzed(data.analyzed || 0);
      setVisionTotal(data.total || 0);
    } catch { /* ignore */ }
  }

  async function loadProperties() {
    const res = await fetch(`/api/tenants/${id}/properties`);
    if (!res.ok) return;
    const data = await res.json();
    setProperties(data.properties || []);
  }

  function handleImageUpdate(imageId, updates) {
    setRefImages(prev => ({
      ...prev,
      post: prev.post.map(img => img.id === imageId ? { ...img, ...updates } : img),
    }));
    // Refresh property counts if property changed
    if (updates.property_id !== undefined) loadProperties();
  }

  function handleImageDelete(imageId) {
    setRefImages(prev => ({ ...prev, post: prev.post.filter(img => img.id !== imageId) }));
    deleteRefImage(imageId);
  }

  function triggerDeleteConfirm(imageId) {
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current);
    if (confirmDeleteId === imageId) {
      // Second click → delete
      setConfirmDeleteId(null);
      deleteRefImage(imageId);
    } else {
      setConfirmDeleteId(imageId);
      confirmDeleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  }

  async function googleAction(action, extra = {}) {
    const res = await fetch(`/api/tenants/${id}/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    return res.json();
  }

  // Pipeline-State aus localStorage wiederherstellen (z.B. nach Seiten-Reload während laufender Pipeline)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gw_pipeline");
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.tenantId !== id || state.status !== "running") return;
      // Modal + Polling wiederherstellen
      const start = state.startedAt;
      const startISO = state.startISO;
      setShowTestModal(true);
      setTestRunning(true);
      setTestStartTime(start);
      setTestElapsedMs(Date.now() - start);
      setTestStep(3); // Mitten drin
      // Polling starten
      const poll = setInterval(async () => {
        try {
          const res = await fetch(`/api/admin/posts?tenantId=${id}&after=${encodeURIComponent(startISO)}`);
          const data = await res.json();
          const post = data.posts?.[0];
          if (!post) return;
          clearInterval(poll);
          const durationMs = Date.now() - start;
          setTestElapsedMs(durationMs);
          setTestRunning(false);
          if (post.status === "failed") {
            showMsg("Pipeline fehlgeschlagen — Details in den Logs", "error");
            setTestStep(0);
          } else {
            setTestStep(6);
            setTestResult({ title: post.blog_title, slug: post.blog_slug, language: post.language, status: post.status, durationMs });
            loadBilling();
            loadTenantPosts(true);
          }
        } catch { /* weiter */ }
      }, 4000);
      pollRef.current = poll;
    } catch { /* ignorieren */ }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC schliesst alle offenen Modals
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (exportModal) { setExportModal(null); return; }
      if (regenModal && !regenLoading) { setRegenModal(null); return; }
      if (postPreview) { setPostPreview(null); return; }
      if (showTestModal && !testRunning) { setShowTestModal(false); return; }
      if (deleteConfirm) { setDeleteConfirm(null); return; }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [postPreview, showTestModal, testRunning, deleteConfirm]);

  // Laufzeit-Timer: tickt alle 200ms während Pipeline läuft
  useEffect(() => {
    if (!testRunning || !testStartTime) return;
    const iv = setInterval(() => setTestElapsedMs(Date.now() - testStartTime), 200);
    return () => clearInterval(iv);
  }, [testRunning, testStartTime]);

  // Dot-Animation: . → .. → ... → .. → . alle 400ms
  useEffect(() => {
    if (!testRunning) return;
    const iv = setInterval(() => setDotPhase(p => (p + 1) % 5), 400);
    return () => clearInterval(iv);
  }, [testRunning]);

  // Poll-Cleanup bei Component-Unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Animated cost counter: zählt zur neuen Summe hoch wenn billingData sich ändert
  useEffect(() => {
    const target = billingData?.openTotal ?? 0;
    const from = displayTotalRef.current;
    if (from === target) return;
    const duration = 800;
    const startTime = performance.now();
    const tick = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const val = Math.round(from + (target - from) * eased);
      displayTotalRef.current = t < 1 ? val : target;
      setDisplayTotal(displayTotalRef.current);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [billingData?.openTotal]);

  async function loadModelLabels() {
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      const labels = {};
      for (const [k, v] of Object.entries(data.recommended_models || {})) {
        labels[k] = `${v.label} (${v.ctx})`;
      }
      setModelLabels(labels);
      if (data.pricing) setSysPricing(p => ({ ...p, ...data.pricing }));
    } catch { /* fallback below */ }
  }

  async function loadTenant() {
    const res = await fetch(`/api/tenants/${id}`);
    const data = await res.json();
    setTenant(data.tenant);
    setSettings(data.settings || {});
    setProfile(data.profile || {});
    setTopics(data.topics || []);
  }

  async function saveSettings() {
    setSaving(true);
    setMsg("");
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_settings", tenantId: id, settings }),
    });
    showMsg("Settings gespeichert");
    setSaving(false);
  }

  async function saveProfile() {
    setSaving(true);
    setMsg("");
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_profile", tenantId: id, profile }),
    });
    showMsg("Profil gespeichert");
    setSaving(false);
  }

  async function saveTopics() {
    setSaving(true);
    setMsg("");
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_topics", tenantId: id, topics }),
    });
    showMsg("Themen gespeichert");
    setSaving(false);
  }

  async function loadBilling() {
    const res = await fetch(`/api/tenants/${id}/billing`);
    const data = await res.json();
    setBillingData(data);
  }

  async function loadTenantPosts(force = false) {
    if (tenantPosts !== null && !force) return;
    try {
      const res = await fetch(`/api/admin/posts?tenantId=${id}`);
      const data = await res.json();
      setTenantPosts(data.posts || []);
    } catch {
      setTenantPosts([]);
      showMsg("Posts konnten nicht geladen werden", "error");
    }
  }

  async function loadPostPreview(postId) {
    setPostPreview(null); // loading state: Modal öffnet sich leer bis Daten da
    const res = await fetch(`/api/admin/posts/${postId}`);
    const data = await res.json();
    if (data.post) setPostPreview(data.post);
    else showMsg("Post konnte nicht geladen werden", "error");
  }

  async function createInvoice() {
    if (!invoiceStart || !invoiceEnd) return;
    setSaving(true);
    await fetch(`/api/tenants/${id}/billing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_invoice", period_start: invoiceStart, period_end: invoiceEnd }),
    });
    showMsg("Abrechnungszeitraum erstellt");
    setInvoiceStart("");
    setInvoiceEnd("");
    loadBilling();
    setSaving(false);
  }

  async function loadRefImages() {
    const res = await fetch(`/api/tenants/${id}/images`);
    const data = await res.json();
    const persona = (data.images || []).filter(i => i.type === "persona").sort((a, b) => a.slot_index - b.slot_index);
    const post = (data.images || []).filter(i => i.type === "post");
    setRefImages({ persona, post });
  }

  async function uploadFile(file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return { url: data.url, thumb: data.thumb };
  }

  async function handlePersonaUpload(slotIndex, file, description) {
    setUploading(true);
    try {
      const { url, thumb } = await uploadFile(file);
      await fetch(`/api/tenants/${id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert_persona", slot_index: slotIndex, image_url: url, thumb_url: thumb, description }),
      });
      loadRefImages();
    } catch (e) { showMsg(`Upload-Fehler: ${e.message}`, "error"); }
    setUploading(false);
  }

  async function handlePostImageUpload(file, description, categories) {
    setUploading(true);
    try {
      const { url, thumb } = await uploadFile(file);
      await fetch(`/api/tenants/${id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_post_image", image_url: url, thumb_url: thumb, description, categories }),
      });
      loadRefImages();
    } catch (e) { showMsg(`Upload-Fehler: ${e.message}`, "error"); }
    setUploading(false);
  }

  async function deleteRefImage(imageId) {
    await fetch(`/api/tenants/${id}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_image", imageId }),
    });
    loadRefImages();
  }

  async function bulkDelete(imageIds) {
    await fetch(`/api/tenants/${id}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bulk_delete", imageIds }),
    });
    setRefImages(prev => ({ ...prev, post: prev.post.filter(img => !imageIds.includes(img.id)) }));
    setSelectedImages(new Set());
    setBulkDeleteConfirm(false);
    loadProperties();
  }

  async function bulkAnalyze() {
    setVisionStatus("running");
    await fetch(`/api/tenants/${id}/images/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    setSelectedImages(new Set());
  }

  async function bulkAddTag(tag) {
    const ids = Array.from(selectedImages);
    if (!tag.trim() || !ids.length) return;
    // Update each image's ai_tags locally and on server
    const t = tag.trim().toLowerCase();
    setRefImages(prev => ({
      ...prev,
      post: prev.post.map(img => selectedImages.has(img.id)
        ? { ...img, ai_tags: [...new Set([...(img.ai_tags || []), t])] }
        : img
      ),
    }));
    await Promise.all(ids.map(imgId => {
      const img = refImages.post.find(i => i.id === imgId);
      const tags = [...new Set([...(img?.ai_tags || []), t])];
      return fetch(`/api/tenants/${id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_image_meta", imageId: imgId, ai_tags: tags }),
      });
    }));
    setBulkTagInput("");
    setShowBulkTagInput(false);
  }

  async function bulkRemoveTag(tag) {
    const ids = Array.from(selectedImages);
    if (!tag.trim() || !ids.length) return;
    const t = tag.trim().toLowerCase();
    setRefImages(prev => ({
      ...prev,
      post: prev.post.map(img => selectedImages.has(img.id)
        ? { ...img, ai_tags: (img.ai_tags || []).filter(x => x !== t) }
        : img
      ),
    }));
    await Promise.all(ids.map(imgId => {
      const img = refImages.post.find(i => i.id === imgId);
      const tags = (img?.ai_tags || []).filter(x => x !== t);
      return fetch(`/api/tenants/${id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_image_meta", imageId: imgId, ai_tags: tags }),
      });
    }));
    setBulkTagInput("");
    setShowBulkTagInput(false);
  }

  async function regenerateImage() {
    if (!regenModal) return;
    setRegenLoading(true);
    try {
      const res = await fetch(`/api/tenants/${id}/posts/${regenModal.postId}/regenerate-image`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        // Post in tenantPosts aktualisieren
        setTenantPosts(posts => posts?.map(p =>
          p.id === regenModal.postId ? { ...p, image_url: data.imageUrl } : p
        ));
        loadBilling();
        showMsg("Bild erfolgreich neu generiert");
        setRegenModal(null);
      } else {
        showMsg(data.error || "Fehler beim Generieren", "error");
      }
    } catch (e) {
      showMsg(e.message, "error");
    }
    setRegenLoading(false);
  }

  async function handleExportHtml(postId, postTitle) {
    try {
      const res = await fetch(`/api/tenants/${id}/posts/${postId}/export-html`);
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        if (data.isTest) {
          setExportModal({ postId, postTitle, upgradeCents: data.upgradeCents, fullPriceCents: data.fullPriceCents });
        }
      } else {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(postTitle || postId).replace(/[^a-z0-9]/gi, "-").toLowerCase()}.html`;
        a.click();
        showMsg("HTML exportiert");
      }
    } catch (e) {
      showMsg(e.message, "error");
    }
  }

  async function confirmExportUpgrade() {
    if (!exportModal) return;
    try {
      const res = await fetch(`/api/tenants/${id}/posts/${exportModal.postId}/export-html?upgrade=1`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(exportModal.postTitle || exportModal.postId).replace(/[^a-z0-9]/gi, "-").toLowerCase()}.html`;
      a.click();
      setExportModal(null);
      loadBilling();
      showMsg("HTML exportiert — Post zur Vollversion aufgewertet");
    } catch (e) {
      showMsg(e.message, "error");
    }
  }

  async function loadUsers() {
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_users", tenantId: id }),
    });
    const data = await res.json();
    setUsers(data.users || []);
  }

  async function createCustomerUser() {
    if (!newUser.email || !newUser.password) return;
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_user", tenantId: id, ...newUser }),
    });
    const data = await res.json();
    if (data.ok) {
      setNewUser({ email: "", name: "", password: "" });
      showMsg("Zugang erstellt");
      loadUsers();
    } else {
      showMsg(data.error || "Fehler", "error");
    }
    setSaving(false);
  }

  async function deleteCustomerUser(userId) {
    setSaving(true);
    await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete_user", userId }),
    });
    showMsg("Zugang gelöscht");
    loadUsers();
    setSaving(false);
  }

  async function updateCustomerUser(userId) {
    setSaving(true);
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_user", userId, ...editUserData }),
    });
    const data = await res.json();
    if (data.ok) {
      showMsg("Zugang aktualisiert");
      setEditingUserId(null);
      loadUsers();
    } else {
      showMsg(data.error || "Fehler beim Speichern", "error");
    }
    setSaving(false);
  }

  async function triggerRun(preview = false, override = null, isTest = false) {
    showMsg("Pipeline wird ausgeführt...");
    const res = await fetch("/api/autopilot/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: id, preview, override, isTest }),
    });
    const data = await res.json();
    if (data.ok) {
      const r = data.results?.[0];
      if (r?.error) {
        showMsg(`Fehler: ${r.error}`, "error");
      } else {
        showMsg(`Fertig! "${r?.title || "Post"}" erstellt (${r?.status})`);
      }
    } else {
      showMsg(`Fehler: ${data.error}`, "error");
    }
  }

  async function runTestPost() {
    const start = Date.now();
    const startISO = new Date(start).toISOString();
    setTestRunning(true);
    setTestStep(0);
    setTestResult(null);
    setTestStartTime(start);
    setTestElapsedMs(0);

    // Fortschritts-Steps: Delays proportional zur geschätzten Gesamtdauer
    const estimated = settings.avg_pipeline_ms ? Math.round(settings.avg_pipeline_ms * 1.1) : 90000;

    // Pill-State in localStorage speichern — PipelinePill liest das seitenübergreifend
    try {
      localStorage.setItem("gw_pipeline", JSON.stringify({
        tenantId: id, tenantName: tenant?.name, startedAt: start,
        estimatedMs: estimated, startISO, status: "running",
      }));
      window.dispatchEvent(new Event("gw_pipeline_update"));
    } catch { /* ignore */ }
    const steps = [
      { frac: 0.00, step: 1 },   // Profil
      { frac: 0.10, step: 2 },   // Thema & Angle
      { frac: 0.20, step: 3 },   // SEO
      { frac: 0.35, step: 4 },   // Schreiben
      { frac: 0.70, step: 5 },   // Bilder
      { frac: 0.88, step: 6 },   // QA
      { frac: 0.94, step: 7 },   // Korrektur (optional)
    ];
    const timers = steps.map(s => setTimeout(() => setTestStep(s.step), s.frac * estimated));

    const override = testMode === "random" ? {} : { categoryIndex: testCatIdx, angleIndex: testAngleIdx };

    // Pipeline starten — Fire & Forget, Antwort kommt sofort zurück
    // Pipeline läuft auf Server weiter, auch wenn Browser/Tab geschlossen wird
    fetch("/api/autopilot/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: id, preview: true, override, isTest: true }),
    }).catch(() => {}); // Netzwerkfehler ignorieren — Pipeline läuft unabhängig

    let done = false;

    // Polling: alle 4s nach neuem Post suchen (created_at > Startzeitpunkt)
    pollRef.current = setInterval(async () => {
      if (done) return;
      try {
        const res = await fetch(`/api/admin/posts?tenantId=${id}&after=${encodeURIComponent(startISO)}`);
        const data = await res.json();
        const post = data.posts?.[0];
        if (!post) return;

        done = true;
        clearInterval(pollRef.current);
        timers.forEach(clearTimeout);
        const durationMs = Date.now() - start;
        setTestElapsedMs(durationMs);
        setTestRunning(false);

        if (post.status === "failed") {
          showMsg("Pipeline fehlgeschlagen — Details in den Logs", "error");
          setTestStep(0);
        } else {
          setTestStep(6);
          setTestResult({
            title: post.blog_title,
            slug: post.blog_slug,
            language: post.language,
            status: post.status,
            durationMs,
          });
          setSettings(s => ({ ...s, avg_pipeline_ms: durationMs }));
          // Kosten + Posts automatisch aktualisieren (kein Reload nötig)
          loadBilling();
          loadTenantPosts(true);
        }
      } catch { /* Netzwerkfehler — weiter warten */ }
    }, 4000);

    // Timeout nach 15 Minuten
    setTimeout(() => {
      if (done) return;
      done = true;
      clearInterval(pollRef.current);
      timers.forEach(clearTimeout);
      setTestRunning(false);
      setTestStep(0);
      showMsg("Timeout: Post wurde nicht gefunden (15 min). Pipeline läuft evtl. noch auf Server.", "error");
    }, 900000);
  }

  if (!tenant) return (
    <div className="animate-pulse">
      <div className="h-4 w-20 bg-muted rounded mb-4" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-7 w-48 bg-muted rounded mb-2" />
          <div className="h-4 w-24 bg-muted rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-muted rounded-lg" />
          <div className="h-9 w-28 bg-muted rounded-lg" />
        </div>
      </div>
      <div className="flex gap-1 mb-6 border-b border-border">
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-9 w-24 bg-muted rounded mb-1 mx-0.5" />)}
      </div>
      <div className="admin-card space-y-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 bg-muted rounded" />)}
      </div>
    </div>
  );

  // Pills berechnen
  const openEuro = billingData?.openTotal > 0 ? `${(billingData.openTotal / 100).toFixed(2)} €` : null;
  const providerPill = settings.billing_mode === "platform" ? "Platform"
    : [settings.text_api_key, settings.image_api_key].filter(Boolean).length > 0
      ? `${[settings.text_api_key, settings.image_api_key].filter(Boolean).length} Key${[settings.text_api_key, settings.image_api_key].filter(Boolean).length > 1 ? "s" : ""}`
      : null;
  const activeTopics = topics.filter(t => t.is_active !== false);
  const avgAnglesCount = activeTopics.length > 0
    ? Math.round(activeTopics.reduce((s, t) => s + (t.angles || DEFAULT_ANGLES).filter(a => a.active !== false).length, 0) / activeTopics.length)
    : 5;
  const topicsCombos = activeTopics.length * avgAnglesCount * 4;

  const tabs = [
    { key: "profile", label: "Firmenprofil" },
    { key: "settings", label: "API & Provider", pill: providerPill, pillColor: "blue" },
    { key: "billing", label: "Kosten", pill: openEuro, pillColor: "amber" },
    { key: "ctas", label: "CTAs" },
    { key: "topics", label: "Themen", pill: topicsCombos > 0 ? `${topicsCombos}` : null, pillColor: "emerald" },
    { key: "images", label: "Bilder", pill: refImages.post.length > 0 ? `${refImages.post.length}` : googleStatus?.syncStatus === "running" ? "⟳" : null, pillColor: "emerald" },
    { key: "posts", label: "Posts", pill: tenantPosts !== null ? `${tenantPosts.length}` : null, pillColor: "default" },
    { key: "reporting", label: "Reporting" },
    { key: "scheduling", label: "Scheduling" },
    { key: "client", label: "Client-Integration" },
    { key: "google", label: "GBP", pill: googleStatus?.gbpConnected ? "✓" : null, pillColor: "emerald" },
    { key: "users", label: "Zugänge" },
  ];

  return (
    <div>
      <Link href="/admin/tenants" className="btn-ghost text-sm mb-4 inline-flex">
        <ArrowLeft size={14} /> Zurück
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">/{tenant.slug}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTestModal(true)} className="btn-ai-outline"><FlaskConical size={14} /> Test-Post</button>
          <button onClick={() => triggerRun(true)} className="btn-outline"><Play size={14} /> Vorschau</button>
          <button onClick={() => triggerRun(false)} className="btn-primary"><Play size={14} /> Jetzt posten</button>
        </div>
      </div>

      {/* Toast */}
      {msg && (
        <div className={`fixed top-6 right-6 z-[9999] min-w-[280px] max-w-[480px] rounded-lg shadow-xl overflow-hidden animate-[slideDown_0.3s_ease-out] ${
          msgType === "error" ? "bg-red-600" : "bg-emerald-600"
        }`}>
          <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-white">
            <span className="flex-1">{msg}</span>
            <button onClick={() => setMsg("")} className="text-white/50 hover:text-white text-lg leading-none">&times;</button>
          </div>
          <div className={`h-[3px] ${msgType === "error" ? "bg-red-300" : "bg-emerald-300"}`}
            style={{ animation: `toastTimer ${msgType === "error" ? "8s" : "4s"} linear forwards` }}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {tabs.map((t) => {
          const pillColors = {
            amber: "bg-amber-100 text-amber-700",
            blue: "bg-blue-100 text-blue-700",
            emerald: "bg-emerald-100 text-emerald-700",
            default: "bg-muted text-muted-foreground",
          };
          const pc = pillColors[t.pillColor] || pillColors.default;
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); if (t.key === "users") loadUsers(); if (t.key === "images") loadRefImages(); if (t.key === "billing") loadBilling(); if (t.key === "posts") loadTenantPosts(); }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.pill != null && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${pc}`}>
                  {t.pill}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab: Profile */}
      {tab === "profile" && (
        <div className="admin-card space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Firmenname" value={profile.company_name} onChange={(v) => setProfile({ ...profile, company_name: v })} />
            <FormField label="Branche" value={profile.industry} onChange={(v) => setProfile({ ...profile, industry: v })} placeholder="Immobilien" />
            <FormField label="Region" value={profile.region} onChange={(v) => setProfile({ ...profile, region: v })} placeholder="Nordhessen" />
            <FormField label="Website" value={profile.website_url} onChange={(v) => setProfile({ ...profile, website_url: v })} placeholder="https://..." />
          </div>
          <FormField label="USP" value={profile.usp} onChange={(v) => setProfile({ ...profile, usp: v })} textarea />
          <FormField label="Positionierung" value={profile.positioning} onChange={(v) => setProfile({ ...profile, positioning: v })} textarea />
          <FormField label="Leistungen" value={profile.services} onChange={(v) => setProfile({ ...profile, services: v })} textarea />
          <FormField label="Brand Voice" value={profile.brand_voice} onChange={(v) => setProfile({ ...profile, brand_voice: v })} placeholder="professionell, nahbar" />
          <FormField label="Zielgruppe" value={profile.target_audience} onChange={(v) => setProfile({ ...profile, target_audience: v })} textarea />
          <FormField label="Sprachen (kommagetrennt)" value={(profile.languages || []).join(", ")} onChange={(v) => setProfile({ ...profile, languages: v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) })} placeholder="de, en, fr" />
          <button onClick={saveProfile} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: CTAs */}
      {tab === "ctas" && (
        <div className="admin-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Call-to-Actions</h3>
            <button
              onClick={() => {
                const ctas = [...(profile.ctas || [])];
                ctas.push({ key: `CTA_${Date.now()}`, label: "", type: "link", channels: [{ type: "url", label: "", value: "" }] });
                setProfile({ ...profile, ctas });
              }}
              className="btn-outline text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400"
            >
              <Plus size={12} /> CTA
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Definiere die verfügbaren CTAs für diesen Kunden. Diese werden in den Themen-Kategorien als Auswahl angezeigt.
          </p>
          <div className="space-y-3">
            {(profile.ctas || []).map((cta, ci) => (
              <div key={ci} className="p-3 rounded-lg border border-border/50 bg-muted/10">
                <div className="grid grid-cols-[1fr_140px_28px] gap-2 items-center mb-2">
                  <input
                    className="form-input text-sm"
                    value={cta.label}
                    onChange={(e) => {
                      const ctas = [...(profile.ctas || [])];
                      ctas[ci] = { ...ctas[ci], label: e.target.value, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "_") || ctas[ci].key };
                      setProfile({ ...profile, ctas });
                    }}
                    placeholder="CTA-Name (z.B. Anrufen)"
                  />
                  <select
                    className="form-select text-sm"
                    value={cta.type}
                    onChange={(e) => {
                      const ctas = [...(profile.ctas || [])];
                      ctas[ci] = { ...ctas[ci], type: e.target.value };
                      setProfile({ ...profile, ctas });
                    }}
                  >
                    <option value="phone">Telefon</option>
                    <option value="email">E-Mail</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="link">Link/Website</option>
                    <option value="social">Social Media</option>
                  </select>
                  <button
                    className="dw-icon-btn-destructive"
                    onClick={() => {
                      const ctas = [...(profile.ctas || [])];
                      ctas.splice(ci, 1);
                      setProfile({ ...profile, ctas });
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="space-y-1.5 ml-2">
                  {(cta.channels || []).map((ch, chi) => (
                    <div key={chi} className="grid grid-cols-[100px_1fr_28px] gap-2 items-center">
                      <input
                        className="form-input text-xs"
                        value={ch.label}
                        onChange={(e) => {
                          const ctas = [...(profile.ctas || [])];
                          const channels = [...ctas[ci].channels];
                          channels[chi] = { ...channels[chi], label: e.target.value };
                          ctas[ci] = { ...ctas[ci], channels };
                          setProfile({ ...profile, ctas });
                        }}
                        placeholder="Bezeichnung"
                      />
                      <input
                        className="form-input text-xs"
                        value={ch.value}
                        onChange={(e) => {
                          const ctas = [...(profile.ctas || [])];
                          const channels = [...ctas[ci].channels];
                          channels[chi] = { ...channels[chi], value: e.target.value };
                          ctas[ci] = { ...ctas[ci], channels };
                          setProfile({ ...profile, ctas });
                        }}
                        placeholder={cta.type === "phone" ? "0561 123456" : cta.type === "email" ? "info@firma.de" : cta.type === "whatsapp" ? "+49..." : "https://..."}
                      />
                      <button
                        className="dw-icon-btn-destructive"
                        onClick={() => {
                          const ctas = [...(profile.ctas || [])];
                          const channels = [...ctas[ci].channels];
                          channels.splice(chi, 1);
                          ctas[ci] = { ...ctas[ci], channels };
                          setProfile({ ...profile, ctas });
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const ctas = [...(profile.ctas || [])];
                      const channels = [...(ctas[ci].channels || [])];
                      channels.push({ type: cta.type, label: "", value: "" });
                      ctas[ci] = { ...ctas[ci], channels };
                      setProfile({ ...profile, ctas });
                    }}
                    className="text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1 mt-1"
                  >
                    <Plus size={10} /> Kanal hinzufügen
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={saveProfile} className="btn-primary mt-4" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: Kosten */}
      {tab === "billing" && (
        <div className="space-y-6">
          {/* Offene Kosten */}
          <div className="admin-card">
            <h3 className="font-semibold mb-3">Offene Kosten</h3>
            {!billingData ? (
              <div className="animate-pulse space-y-2">
                <div className="h-10 bg-muted rounded" />
                <div className="h-10 bg-muted rounded" />
              </div>
            ) : billingData.openPosts?.length > 0 ? (
              <>
                <div className="divide-y divide-border/30">
                  {billingData.openPosts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-2 px-2 rounded hover:bg-amber-50/50 cursor-pointer" onClick={() => loadPostPreview(p.id)}>
                      <div>
                        <p className="text-sm font-medium">
                          {p.blog_title}
                          {p.is_test && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">Test</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{p.category} · {p.angle} · {new Date(p.created_at).toLocaleDateString("de")}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {p.is_test && p.full_cost_cents > 0 && p.calculated_price < p.full_cost_cents && (
                          <span className="text-[10px] text-muted-foreground/50 line-through tabular-nums">
                            {(p.full_cost_cents / 100).toFixed(2)} €
                          </span>
                        )}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full tabular-nums ${
                          p.is_test ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700"
                        }`}>
                          {((p.calculated_price != null ? p.calculated_price : (billingData.pricing?.post_price_cents ?? 300)) / 100).toFixed(2)} €
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {billingData.openCycles?.length > 0 && billingData.openCycles.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2 px-2 text-muted-foreground">
                    <div>
                      <p className="text-sm">Mitgliedsbeitrag</p>
                      <p className="text-xs text-muted-foreground/70">
                        {new Date(c.cycle_start).toLocaleDateString("de")} – {new Date(c.cycle_end).toLocaleDateString("de")}
                      </p>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                      {(c.amount_cents / 100).toFixed(2)} €
                    </span>
                  </div>
                ))}
                {billingData.openRegens?.length > 0 && billingData.openRegens.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 px-2 text-muted-foreground">
                    <div>
                      <p className="text-sm">Bild neu generiert</p>
                      <p className="text-xs text-muted-foreground/70 line-clamp-1">{r.post_title} · {new Date(r.created_at).toLocaleDateString("de")}</p>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 tabular-nums">
                      {(r.cost_cents / 100).toFixed(2)} €
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <span className="text-sm font-semibold">Summe offen</span>
                  <span className="text-sm font-bold text-amber-700 tabular-nums transition-all">
                    {(displayTotal / 100).toFixed(2)} €
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Keine offenen Kosten.</p>
            )}
          </div>

          {/* Zeitraum abrechnen */}
          <div className="admin-card">
            <h3 className="font-semibold mb-3">Zeitraum abrechnen</h3>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div className="form-group">
                <label className="form-label">Von</label>
                <input type="date" className="form-input text-sm" value={invoiceStart} onChange={(e) => setInvoiceStart(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Bis</label>
                <input type="date" className="form-input text-sm" value={invoiceEnd} onChange={(e) => setInvoiceEnd(e.target.value)} />
              </div>
              <button onClick={createInvoice} className="btn-primary h-9" disabled={saving || !invoiceStart || !invoiceEnd}>
                Abrechnen
              </button>
            </div>
          </div>

          {/* Vergangene Abrechnungen */}
          <div className="admin-card">
            <h3 className="font-semibold mb-3">Abrechnungshistorie</h3>
            {billingData?.periods?.length > 0 ? (
              <div className="space-y-2">
                {billingData.periods.map((p) => (
                  <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                    p.status === "paid" ? "bg-muted/30 border-border" :
                    p.status === "invoiced" ? "bg-gray-50 border-gray-200" :
                    "bg-amber-50/50 border-amber-200"
                  }`}>
                    <div>
                      <p className="text-sm font-medium">
                        {new Date(p.period_start).toLocaleDateString("de")} – {new Date(p.period_end).toLocaleDateString("de")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.post_count} Posts · {p.backlink_count} Backlinks
                        {p.membership_cents > 0 && ` · Mitglied ${(p.membership_cents / 100).toFixed(2)} €`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{(p.total_cents / 100).toFixed(2)} €</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        p.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                        p.status === "invoiced" ? "bg-gray-200 text-gray-600" :
                        "bg-amber-100 text-amber-700"
                      }`}>
                        {p.status === "paid" ? "Bezahlt" : p.status === "invoiced" ? "In Rechnung gestellt" : "Offen"}
                      </span>
                      {p.status === "invoiced" && (
                        <button
                          className="text-[10px] text-emerald-600 hover:underline"
                          onClick={async () => {
                            await fetch(`/api/tenants/${id}/billing`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "update_status", periodId: p.id, status: "paid" }),
                            });
                            loadBilling();
                          }}
                        >
                          Als bezahlt markieren
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Noch keine Abrechnungen.</p>
            )}
          </div>
        </div>
      )}

      {/* Tab: Settings (API Keys) */}
      {tab === "settings" && (
        <div className="admin-card space-y-6">
          {/* Billing Mode — Radio Buttons */}
          <div>
            <h3 className="font-semibold mb-3">Abrechnungsmodell</h3>
            <div className="space-y-2">
              <label
                className={`radio-option flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
                  (settings.billing_mode || "own_key") === "platform"
                    ? "radio-option-active border-emerald-400 bg-emerald-50"
                    : "border-border"
                }`}
                onClick={() => setSettings({ ...settings, billing_mode: "platform" })}
              >
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  (settings.billing_mode || "own_key") === "platform" ? "border-emerald-500" : "border-gray-300"
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full transition-all ${
                    (settings.billing_mode || "own_key") === "platform" ? "bg-emerald-500 scale-100" : "bg-transparent scale-0"
                  }`} />
                </span>
                <div className="flex-1">
                  <p className="font-medium text-sm">Platform (All-Inclusive)</p>
                  <p className="text-xs text-muted-foreground">Text + 2 Bilder + SEO inklusive</p>
                </div>
                <span className="text-sm font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">~{(sysPricing.post_price_cents / 100).toFixed(2).replace(".", ",")} €/Post</span>
              </label>
              <label
                className={`radio-option flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
                  (settings.billing_mode || "own_key") === "own_key"
                    ? "radio-option-active-alt border-primary bg-primary/5"
                    : "border-border"
                }`}
                onClick={() => setSettings({ ...settings, billing_mode: "own_key" })}
              >
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  (settings.billing_mode || "own_key") === "own_key" ? "border-primary" : "border-gray-300"
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full transition-all ${
                    (settings.billing_mode || "own_key") === "own_key" ? "bg-primary scale-100" : "bg-transparent scale-0"
                  }`} />
                </span>
                <div className="flex-1">
                  <p className="font-medium text-sm">Eigene API Keys</p>
                  <p className="text-xs text-muted-foreground">Kunde bringt eigene Keys mit</p>
                </div>
                <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">€0</span>
              </label>
            </div>
          </div>

          <hr className="border-border" />

          {/* Options */}
          <div>
            <h3 className="font-semibold mb-3">Optionen</h3>
            <div className="space-y-2">
              <label
                className={`radio-option flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
                  settings.backlinks_enabled
                    ? "radio-option-active border-emerald-400 bg-emerald-50"
                    : "border-border"
                }`}
                onClick={() => setSettings({ ...settings, backlinks_enabled: true })}
              >
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  settings.backlinks_enabled ? "border-emerald-500" : "border-gray-300"
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full transition-all ${
                    settings.backlinks_enabled ? "bg-emerald-500 scale-100" : "bg-transparent scale-0"
                  }`} />
                </span>
                <div className="flex-1">
                  <p className="font-medium text-sm">Backlinks aktiv</p>
                  <p className="text-xs text-muted-foreground">Gegenseitige Verlinkung mit nicht-konkurrierenden Firmen (SEO-Boost)</p>
                </div>
                <span className="text-sm font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">+€1/Post</span>
              </label>
              <label
                className={`radio-option flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
                  !settings.backlinks_enabled
                    ? "radio-option-active-alt border-primary bg-primary/5"
                    : "border-border"
                }`}
                onClick={() => setSettings({ ...settings, backlinks_enabled: false })}
              >
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  !settings.backlinks_enabled ? "border-primary" : "border-gray-300"
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full transition-all ${
                    !settings.backlinks_enabled ? "bg-primary scale-100" : "bg-transparent scale-0"
                  }`} />
                </span>
                <div className="flex-1">
                  <p className="font-medium text-sm">Ohne Backlinks</p>
                  <p className="text-xs text-muted-foreground">Posts ohne externen Backlink</p>
                </div>
                <span className="text-sm font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">€0</span>
              </label>

              {/* Content Refresh — unabhängiger Toggle */}
              {(() => {
                const refreshCents = Math.round(sysPricing.post_price_cents * (1 - (sysPricing.refresh_discount_percent ?? 40) / 100));
                const discount = sysPricing.refresh_discount_percent ?? 40;
                return (
                  <div
                    className={`flex items-start justify-between p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                      settings.refresh_enabled ? "border-emerald-400 bg-emerald-50" : "border-border hover:border-muted-foreground/30"
                    }`}
                    onClick={() => setSettings({ ...settings, refresh_enabled: !settings.refresh_enabled })}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Content Refresh</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Ältere Artikel verlieren Rankings durch veraltete Zahlen. Ghostwriter aktualisiert automatisch Fakten + Jahreszahlen — mehr Traffic ohne neuen Post.
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Posts &gt; 180 Tage · max. 1 Post/Tenant/Tag · {discount}% Rabatt auf Normalpreis
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 ml-4 flex-shrink-0">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        settings.refresh_enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                      }`}>
                        {settings.refresh_enabled ? "Aktiv" : "Inaktiv"}
                      </span>
                      <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        {(refreshCents / 100).toFixed(2)} €/Post
                      </span>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>

          <hr className="border-border" />

          {/* API Keys — nur bei own_key sichtbar */}
          {(settings.billing_mode || "own_key") === "own_key" && (<>
          <div>
            <h3 className="font-semibold mb-3">Text-Modell</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select className="form-select" value={settings.text_provider || "anthropic"} onChange={(e) => setSettings({ ...settings, text_provider: e.target.value })}>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="mistral">Mistral</option>
                  <option value="custom">Custom Endpoint</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Modell</label>
                <p className="form-input bg-muted/30 text-muted-foreground cursor-default">
                  {modelLabels[settings.text_provider || "anthropic"] || "Auto"}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Gepflegt unter Settings → Empfohlene Modelle</p>
              </div>
            </div>
            <FormField label="API Key" value={settings.text_api_key} onChange={(v) => setSettings({ ...settings, text_api_key: v })} placeholder="sk-..." type="password" />
            {settings.text_provider === "custom" && (
              <FormField label="Custom Endpoint" value={settings.text_custom_endpoint} onChange={(v) => setSettings({ ...settings, text_custom_endpoint: v })} placeholder="https://..." />
            )}
          </div>

          <hr className="border-border" />

          <div>
            <h3 className="font-semibold mb-3">Bild-Modell</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select className="form-select" value={settings.image_provider || "dalle3"} onChange={(e) => setSettings({ ...settings, image_provider: e.target.value })}>
                  <option value="dalle3">DALL-E 3 (OpenAI)</option>
                  <option value="gpt-image">GPT Image (gpt-image-1)</option>
                  <option value="flux">Flux Schnell (fal.ai)</option>
                  <option value="imagen">Imagen 3 (Google)</option>
                  <option value="stock">Stock (Unsplash/Pexels)</option>
                  <option value="custom">Custom Endpoint</option>
                </select>
              </div>
              <FormField label="Bild API Key" value={settings.image_api_key} onChange={(v) => setSettings({ ...settings, image_api_key: v })} type="password" />
            </div>
            <FormField label="Bild-Stil Prefix" value={settings.image_style_prefix} onChange={(v) => setSettings({ ...settings, image_style_prefix: v })} textarea placeholder="Fotorealistisch, professionell, keine KI-Gesichter..." />
            {settings.image_provider === "custom" && (
              <FormField label="Custom Image Endpoint" value={settings.image_custom_endpoint} onChange={(v) => setSettings({ ...settings, image_custom_endpoint: v })} placeholder="https://api.example.com/v1/images/generations" />
            )}
          </div>
          </>)}

          {(settings.billing_mode || "own_key") === "platform" && (
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="text-sm font-medium text-emerald-800">Platform-Modus aktiv</p>
              <p className="text-xs text-emerald-700 mt-1">
                API Keys werden von Code-Lederhos bereitgestellt. Abrechnung: ~{(sysPricing.post_price_cents / 100).toFixed(2).replace(".", ",")} € pro Post (Text + 2 Bilder + SEO).
                Keine eigenen Keys nötig.
              </p>
            </div>
          )}

          <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: Topics */}
      {tab === "topics" && (() => {
        const activeCategories = topics.filter(t => t.is_active !== false).length;
        const activeAngles = topics.reduce((sum, t) => sum + ((t.angles || DEFAULT_ANGLES).filter(a => a.active !== false).length), 0);
        const avgAngles = activeCategories > 0 ? Math.round(activeAngles / activeCategories) : 5;
        const combos = activeCategories * avgAngles * 4;
        const freqDays = settings.frequency_hours ? settings.frequency_hours / 24 : 3;
        const years = Math.floor(combos * freqDays / 365 * 10) / 10;

        const handleCatDragStart = (i) => setDragItem({ type: "cat", catIdx: i });
        const handleCatDragOver = (e, i) => {
          e.preventDefault();
          if (!dragItem) return;
          if (dragItem.type === "cat" && dragItem.catIdx === i) return;
          if (dragItem.type === "angle" && dragItem.catIdx === i) return;
          setDropTarget({ type: dragItem.type === "angle" ? "angle-on-cat" : "cat", catIdx: i });
        };
        const handleCatDrop = (i) => {
          if (!dragItem) return;
          if (dragItem.type === "angle") {
            // Angle auf Kategorie-Header droppen → ans Ende einfügen
            const n = [...topics];
            const srcAngles = [...(n[dragItem.catIdx].angles || DEFAULT_ANGLES)];
            const [moved] = srcAngles.splice(dragItem.angleIdx, 1);
            n[dragItem.catIdx].angles = srcAngles.map((a, idx) => ({ ...a, key: idx + 1 }));
            const dstAngles = [...(n[i].angles || DEFAULT_ANGLES)];
            dstAngles.push(moved);
            n[i].angles = dstAngles.map((a, idx) => ({ ...a, key: idx + 1 }));
            setTopics(n);
            setDragItem(null);
            setDropTarget(null);
            return;
          }
          if (dragItem.type !== "cat") return;
          const n = [...topics];
          const [moved] = n.splice(dragItem.catIdx, 1);
          n.splice(i, 0, moved);
          n.forEach((t, idx) => t.category_id = idx);
          setTopics(n);
          setDragItem(null);
          setDropTarget(null);
        };

        const handleAngleDragStart = (catIdx, angleIdx) => setDragItem({ type: "angle", catIdx, angleIdx });
        const handleAngleDragOver = (e, catIdx, angleIdx) => {
          e.preventDefault();
          if (!dragItem || dragItem.type !== "angle") return;
          setDropTarget({ type: "angle", catIdx, angleIdx });
        };
        const handleAngleDrop = (targetCatIdx, targetAngleIdx) => {
          if (!dragItem || dragItem.type !== "angle") return;
          const n = [...topics];
          const srcAngles = [...(n[dragItem.catIdx].angles || DEFAULT_ANGLES)];
          const [moved] = srcAngles.splice(dragItem.angleIdx, 1);
          if (dragItem.catIdx === targetCatIdx) {
            srcAngles.splice(targetAngleIdx, 0, moved);
            n[targetCatIdx].angles = srcAngles.map((a, i) => ({ ...a, key: i + 1 }));
          } else {
            n[dragItem.catIdx].angles = srcAngles.map((a, i) => ({ ...a, key: i + 1 }));
            const dstAngles = [...(n[targetCatIdx].angles || DEFAULT_ANGLES)];
            dstAngles.splice(targetAngleIdx, 0, moved);
            n[targetCatIdx].angles = dstAngles.map((a, i) => ({ ...a, key: i + 1 }));
          }
          setTopics(n);
          setDragItem(null);
          setDropTarget(null);
        };

        const handleDragEnd = () => { setDragItem(null); setDropTarget(null); };

        const addAngle = (catIdx) => {
          const n = [...topics];
          const angles = [...(n[catIdx].angles || DEFAULT_ANGLES)];
          angles.push({ key: angles.length + 1, label: "", active: true });
          n[catIdx].angles = angles;
          setTopics(n);
        };

        const removeAngle = (catIdx, angleIdx) => {
          const n = [...topics];
          const angles = [...(n[catIdx].angles || DEFAULT_ANGLES)];
          angles.splice(angleIdx, 1);
          n[catIdx].angles = angles.map((a, i) => ({ ...a, key: i + 1 }));
          setTopics(n);
        };

        return (
          <div className="admin-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Themen-Kategorien</h3>
              <button
                onClick={() => setTopics([...topics, { category_id: topics.length, label: "", description: "", default_cta: "LEARN_MORE", is_active: true, angles: [...DEFAULT_ANGLES] }])}
                className="btn-outline text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-400"
              >
                <Plus size={12} /> Kategorie
              </button>
            </div>

            {/* Coverage */}
            <div className="mb-4 px-3 py-2 rounded-lg bg-muted/50 text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span><strong className="text-foreground">{activeCategories}</strong> Kat.</span>
              <span>×</span>
              <span><strong className="text-foreground">{avgAngles}</strong> Angles</span>
              <span>×</span>
              <span><strong className="text-foreground">4</strong> Saisons</span>
              <span>=</span>
              <span className="text-emerald-600 font-medium">{combos} Kombinationen (~{years} J.)</span>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-[24px_24px_1fr_2fr_120px_28px] gap-2 px-2 pb-2 border-b border-border text-xs font-medium text-muted-foreground">
              <span></span>
              <span>#</span>
              <span>Kategorie</span>
              <span>Beschreibung</span>
              <span>CTA</span>
              <span></span>
            </div>

            {/* Category List */}
            <div className="divide-y divide-border/30">
              {topics.map((t, i) => {
                const isExpanded = expandedTopic === i;
                const angles = t.angles || DEFAULT_ANGLES;
                const isDragOverCat = (dropTarget?.type === "cat" || dropTarget?.type === "angle-on-cat") && dropTarget.catIdx === i;
                return (
                  <div key={i}
                    onDragOver={(e) => handleCatDragOver(e, i)}
                    onDrop={() => handleCatDrop(i)}
                  >
                    {/* Category Row */}
                    <div
                      className={`grid grid-cols-[24px_24px_1fr_2fr_120px_28px] gap-2 items-center px-2 py-2.5 rounded-lg transition-all ${
                        hoverDelete?.type === "cat" && hoverDelete.catIdx === i
                          ? "bg-red-50 ring-1 ring-red-200"
                          : isDragOverCat
                            ? "bg-emerald-50 ring-2 ring-emerald-400 ring-inset"
                            : dragItem?.type === "cat" && dragItem.catIdx === i ? "opacity-40" : "hover:bg-muted/30"
                      }`}
                      draggable
                      onDragStart={() => handleCatDragStart(i)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground" data-drag-handle>
                        <GripVertical size={14} />
                      </span>
                      <button
                        className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
                        onClick={() => setExpandedTopic(isExpanded ? null : i)}
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {i}
                      </button>
                      <input
                        className="form-input text-sm"
                        value={t.label}
                        onChange={(e) => { const n = [...topics]; n[i].label = e.target.value; setTopics(n); }}
                        placeholder="Kategorie"
                      />
                      <input
                        className="form-input text-sm"
                        value={t.description}
                        onChange={(e) => { const n = [...topics]; n[i].description = e.target.value; setTopics(n); }}
                        placeholder="Beschreibung"
                      />
                      <select
                        className="form-select text-sm"
                        value={t.default_cta}
                        onChange={(e) => { const n = [...topics]; n[i].default_cta = e.target.value; setTopics(n); }}
                      >
                        {(profile.ctas || [{ key: "LEARN_MORE", label: "Mehr erfahren" }, { key: "CALL", label: "Anrufen" }]).map((cta) => (
                          <option key={cta.key} value={cta.key}>{cta.label}</option>
                        ))}
                      </select>
                      <button
                        className="dw-icon-btn-destructive"
                        onMouseEnter={() => setHoverDelete({ type: "cat", catIdx: i })}
                        onMouseLeave={() => setHoverDelete(null)}
                        onClick={() => {
                          if (Date.now() - lastDeleteAt < 3000) {
                            setTopics(topics.filter((_, j) => j !== i));
                            if (isExpanded) setExpandedTopic(null);
                            setLastDeleteAt(Date.now());
                          } else {
                            setDeleteConfirm({ type: "cat", catIdx: i, label: t.label || `Kategorie ${i}` });
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Expanded: Angles */}
                    {isExpanded && (
                      <div className="ml-10 mr-2 mb-3 mt-0.5 p-3 rounded-lg border border-border/50 bg-muted/20">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-muted-foreground">Angles (Blickwinkel)</p>
                          <button onClick={() => addAngle(i)} className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1">
                            <Plus size={11} /> Angle
                          </button>
                        </div>
                        <div className="space-y-1">
                          {angles.map((angle, ai) => {
                            const isDragOverAngle = dropTarget?.type === "angle" && dropTarget.catIdx === i && dropTarget.angleIdx === ai;
                            return (
                              <div
                                key={ai}
                                className={`flex items-center gap-2 py-1 px-1 rounded transition-all ${
                                  hoverDelete?.type === "angle" && hoverDelete.catIdx === i && hoverDelete.angleIdx === ai
                                    ? "bg-red-50 ring-1 ring-red-200"
                                    : isDragOverAngle ? "border-t-2 border-emerald-400" : ""
                                } ${dragItem?.type === "angle" && dragItem.catIdx === i && dragItem.angleIdx === ai ? "opacity-40" : "hover:bg-muted/30"}`}
                                draggable
                                onDragStart={(e) => { e.stopPropagation(); handleAngleDragStart(i, ai); }}
                                onDragOver={(e) => { e.stopPropagation(); handleAngleDragOver(e, i, ai); }}
                                onDrop={(e) => { e.stopPropagation(); handleAngleDrop(i, ai); }}
                                onDragEnd={handleDragEnd}
                              >
                                <span className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground">
                                  <GripVertical size={12} />
                                </span>
                                <input
                                  type="checkbox"
                                  checked={angle.active !== false}
                                  onChange={() => {
                                    const n = [...topics];
                                    const a = [...(n[i].angles || DEFAULT_ANGLES)];
                                    a[ai] = { ...a[ai], active: !a[ai].active };
                                    n[i].angles = a;
                                    setTopics(n);
                                  }}
                                  className="rounded border-border"
                                />
                                <span className="text-xs text-muted-foreground w-4 text-center">{angle.key}</span>
                                <input
                                  className="form-input text-sm flex-1"
                                  value={angle.label}
                                  onChange={(e) => {
                                    const n = [...topics];
                                    const a = [...(n[i].angles || DEFAULT_ANGLES)];
                                    a[ai] = { ...a[ai], label: e.target.value };
                                    n[i].angles = a;
                                    setTopics(n);
                                  }}
                                  placeholder="Angle-Bezeichnung"
                                />
                                <button
                                  className="dw-icon-btn-destructive"
                                  onMouseEnter={() => setHoverDelete({ type: "angle", catIdx: i, angleIdx: ai })}
                                  onMouseLeave={() => setHoverDelete(null)}
                                  onClick={() => {
                                    if (Date.now() - lastDeleteAt < 3000) {
                                      removeAngle(i, ai);
                                      setLastDeleteAt(Date.now());
                                    } else {
                                      setDeleteConfirm({ type: "angle", catIdx: i, angleIdx: ai, label: angle.label || `Angle ${ai + 1}` });
                                    }
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground/60 mt-2 italic">
                          Saison wird automatisch erkannt. Angles können per Drag & Drop zwischen Kategorien verschoben werden.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={saveTopics} className="btn-primary mt-4" disabled={saving}><Save size={14} /> Speichern</button>

            {/* Delete Confirm Modal */}
            {deleteConfirm && (
              <div className="dw-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
                <div className="dw-modal" style={{ width: "min(380px, 90vw)" }}>
                  <div className="dw-modal-header">
                    <h2>Wirklich löschen?</h2>
                    <button className="dw-icon-btn" onClick={() => setDeleteConfirm(null)}>&times;</button>
                  </div>
                  <div className="dw-modal-body">
                    <p className="text-sm text-muted-foreground mb-4">
                      <strong className="text-foreground">{deleteConfirm.label}</strong> wird unwiderruflich entfernt.
                    </p>
                    <div className="flex justify-end gap-2">
                      <button className="btn-outline" onClick={() => setDeleteConfirm(null)}>Abbrechen</button>
                      <button className="btn-destructive" onClick={() => {
                        if (deleteConfirm.type === "cat") {
                          setTopics(topics.filter((_, j) => j !== deleteConfirm.catIdx));
                          if (expandedTopic === deleteConfirm.catIdx) setExpandedTopic(null);
                        } else {
                          removeAngle(deleteConfirm.catIdx, deleteConfirm.angleIdx);
                        }
                        setLastDeleteAt(Date.now());
                        setDeleteConfirm(null);
                        setHoverDelete(null);
                      }}>Löschen</button>
                    </div>
                    <p className="text-[11px] text-muted-foreground/60 mt-3 text-center italic">
                      Nach Bestätigung: weitere Löschungen innerhalb 3s ohne Nachfrage
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Tab: Referenzbilder */}
      {tab === "images" && (
        <div className="space-y-6">

          {/* Google Drive Sync */}
          {(() => {
            const isRunning = googleStatus?.syncStatus === "running";
            const isDone = googleStatus?.syncStatus === "done";
            const isActive = googleStatus?.driveEnabled;
            const syncTotal = googleStatus?.syncTotal || 0;
            const syncDone = googleStatus?.syncDone || 0;
            const syncPct = syncTotal > 0 ? Math.round((syncDone / syncTotal) * 100) : 0;

            return (
              <div className={`admin-card space-y-4 transition-all duration-300 ${isActive ? "border-emerald-300 bg-emerald-50/30" : ""}`}>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">Google Drive — Referenzbilder</h3>
                      {isRunning && (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Sync läuft…
                        </span>
                      )}
                      {isDone && googleStatus?.syncAdded > 0 && (
                        <span className="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          +{googleStatus.syncAdded} neu ✓
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {isRunning
                        ? `${syncDone} von ${syncTotal} Bilder konvertiert…`
                        : "Drive-Ordner verbinden → täglich automatisch synchronisiert."}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer shrink-0">
                    <div
                      className={`relative w-10 h-5 rounded-full transition-colors ${isActive ? "bg-emerald-500" : "bg-muted"}`}
                      onClick={async () => {
                        const enabled = !googleStatus?.driveEnabled;
                        await googleAction("toggle_drive", { enabled });
                        setGoogleStatus(s => ({ ...s, driveEnabled: enabled }));
                      }}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${isActive ? "left-5" : "left-0.5"}`} />
                    </div>
                    <span className="text-sm font-medium" style={{ color: isActive ? "#16a34a" : undefined }}>
                      {isActive ? "Aktiv" : "Deaktiviert"}
                    </span>
                  </label>
                </div>

                {/* Fortschrittsbalken während Sync */}
                {isRunning && syncTotal > 0 && (
                  <div className="space-y-1.5">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                        style={{ width: `${syncPct}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-right">{syncPct}% · {syncDone}/{syncTotal}</p>
                  </div>
                )}

                {/* Skeleton-Grid während Sync */}
                {isRunning && syncTotal > 0 && (
                  <div className="grid grid-cols-5 gap-2">
                    {Array.from({ length: Math.min(syncTotal, 20) }).map((_, i) => {
                      const loaded = i < syncDone;
                      const recentImages = refImages.post.slice(-syncDone);
                      const img = loaded ? recentImages[i] : null;
                      return (
                        <div
                          key={i}
                          className={`aspect-square rounded-lg overflow-hidden transition-all duration-500 ${loaded ? "opacity-100 scale-100" : "opacity-60 scale-95"}`}
                        >
                          {img ? (
                            <img
                              src={img.thumb_url || img.image_url}
                              className="w-full h-full object-cover"
                              alt=""
                            />
                          ) : (
                            <div className="w-full h-full bg-muted animate-pulse rounded-lg" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* SA-Email Anleitung */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-medium text-blue-800">Drive-Ordner freigeben:</p>
                  <p className="text-xs text-blue-700">Rechtsklick auf Ordner → Freigeben → diese E-Mail als Betrachter:</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-white border border-blue-200 rounded px-2 py-1 flex-1 break-all">
                      {googleStatus?.serviceAccountEmail || "ghostwriter-drive@ghostwriter-490820.iam.gserviceaccount.com"}
                    </code>
                    <button
                      className="btn-ghost text-xs shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(googleStatus?.serviceAccountEmail || "ghostwriter-drive@ghostwriter-490820.iam.gserviceaccount.com");
                        showMsg("E-Mail kopiert ✓");
                      }}
                    >Kopieren</button>
                  </div>
                </div>

                {/* Ordner-ID + Sync-Button */}
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Ordner-ID (aus Drive-URL)</label>
                    {googleStatus?.driveFolderName && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                        <span>📁</span><span>{googleStatus.driveFolderName}</span>
                      </div>
                    )}
                    <input
                      className="input w-full text-sm font-mono"
                      placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74"
                      defaultValue={googleStatus?.driveFolderId || ""}
                      disabled={isRunning}
                      onBlur={async (e) => {
                        const folderId = e.target.value.trim();
                        if (!folderId || folderId === googleStatus?.driveFolderId) return;
                        const res = await googleAction("set_folder", { folderId });
                        setGoogleStatus(s => ({ ...s, driveFolderId: folderId, driveFolderName: res.folderName }));
                        if (res.folderName) showMsg(`Ordner "${res.folderName}" gespeichert ✓`);
                        else showMsg("Zugriff prüfen — SA-Email geteilt?", "error");
                      }}
                    />
                  </div>
                  <button
                    className={`text-sm shrink-0 px-4 py-2 rounded-lg font-medium transition-all ${isRunning ? "bg-emerald-100 text-emerald-700 cursor-not-allowed" : "btn-secondary"}`}
                    disabled={isRunning || !googleStatus?.driveFolderId}
                    onClick={async () => {
                      const res = await googleAction("sync_drive");
                      if (res.ok) {
                        setGoogleStatus(s => ({ ...s, syncStatus: "running", syncDone: 0, syncTotal: 0, syncAdded: 0 }));
                      } else {
                        showMsg(res.error || "Sync fehlgeschlagen", "error");
                      }
                    }}
                  >
                    {isRunning ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        {syncDone}/{syncTotal || "…"}
                      </span>
                    ) : "Sync starten"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Bilder werden als WebP konvertiert · täglich 03:00 Uhr automatisch · Sub-Ordner werden durchsucht
                </p>
              </div>
            );
          })()}

          {/* Persona */}
          <div className="admin-card">
            <h3 className="font-semibold mb-2">Persona (Markenperson)</h3>
            <p className="text-xs text-muted-foreground mb-3">
              4 Bilder der Markenperson für konsistente KI-Bildgenerierung. Kopfbilder + Ganzkörper + Pose.
            </p>
            <div className="mb-3">
              <FormField
                label="Persona-Vorgaben"
                value={profile.persona_guidelines}
                onChange={(v) => setProfile({ ...profile, persona_guidelines: v })}
                textarea
                placeholder="z.B. Mann, 45 Jahre, professioneller Look, dunkles Haar, Anzug. Freundliches Lächeln..."
              />
            </div>
            {/* Labels Zeile */}
            <div className="grid grid-cols-4 gap-3 mb-1">
              {["Kopf frontal", "Kopf seitlich", "Ganzkörper", "Andere Pose"].map((l, i) => (
                <p key={i} className="text-xs font-medium text-muted-foreground">{l}</p>
              ))}
            </div>
            {/* Bild-Slots */}
            <div className="grid grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((slot) => {
                const img = refImages.persona.find(i => i.slot_index === slot);
                const labels = ["Kopf frontal", "Kopf seitlich", "Ganzkörper", "Andere Pose"];
                return (
                  <div key={slot} className="relative group">
                    {img ? (
                      <div className="relative">
                        <img src={img.thumb_url || img.image_url} alt={img.description || labels[slot]} className="w-full aspect-square object-cover rounded-lg border border-border cursor-pointer" onClick={() => window.open(img.image_url, "_blank")} title="Klicken zum Vergrößern" />
                        <button
                          onClick={() => deleteRefImage(img.id)}
                          className="absolute top-1 right-1 dw-icon-btn-destructive bg-white/80 backdrop-blur-sm !w-6 !h-6"
                        >
                          <Trash2 size={10} />
                        </button>
                        <input
                          className="form-input text-xs mt-1"
                          value={img.description || ""}
                          onChange={async (e) => {
                            await fetch(`/api/tenants/${id}/images`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "upsert_persona", slot_index: slot, image_url: img.image_url, description: e.target.value }),
                            });
                          }}
                          onBlur={loadRefImages}
                          placeholder="Beschreibung..."
                        />
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center aspect-square rounded-lg border-2 border-dashed border-border hover:border-emerald-400 hover:bg-emerald-50/50 cursor-pointer transition-colors">
                        <Plus size={20} className="text-muted-foreground/40 mb-1" />
                        <span className="text-[10px] text-muted-foreground/60">Bild hochladen</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handlePersonaUpload(slot, f, labels[slot]);
                          }}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={saveProfile} className="btn-primary mt-3" disabled={saving}><Save size={14} /> Persona speichern</button>
          </div>

          {/* Post-Bilder */}
          <div className="admin-card">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <h3 className="font-semibold">Post-Referenzbilder</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Eigene Fotos hochladen — passt das Bild zum Artikel, wird es direkt genutzt (kein KI-Generate). Kein passendes Bild: KI generiert neu.
                </p>
              </div>
              {refImages.post.length > 0 && (
                <button
                  className={`shrink-0 text-sm px-3 py-1.5 rounded-lg font-medium transition-all ${
                    visionStatus === "running"
                      ? "bg-violet-100 text-violet-700 cursor-not-allowed"
                      : "bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100"
                  }`}
                  disabled={visionStatus === "running"}
                  onClick={async () => {
                    const res = await fetch(`/api/tenants/${id}/images/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onlyUnanalyzed: true }) });
                    const data = await res.json();
                    if (data.ok && data.total > 0) {
                      setVisionStatus("running");
                      setVisionAnalyzed(0);
                      setVisionTotal(data.total);
                    } else if (data.total === 0) {
                      showMsg("Alle Bilder bereits analysiert ✓");
                    } else {
                      showMsg("Analyse fehlgeschlagen", "error");
                    }
                  }}
                >
                  {visionStatus === "running" ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                      {visionAnalyzed}/{visionTotal || "…"}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      ✨ Auto-beschreiben
                      {visionTotal > 0 && visionAnalyzed < visionTotal && (
                        <span className="text-[10px] bg-violet-200 text-violet-800 rounded-full px-1.5">{visionTotal - visionAnalyzed}</span>
                      )}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Vision-Analyse Fortschritt */}
            {visionStatus === "running" && visionTotal > 0 && (
              <div className="space-y-1 mb-3">
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full transition-all duration-700"
                    style={{ width: `${Math.round((visionAnalyzed / visionTotal) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">{Math.round((visionAnalyzed / visionTotal) * 100)}% · KI analysiert Bilder…</p>
              </div>
            )}
            {visionStatus === "done" && (
              <div className="mb-3 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {visionAnalyzed} Bilder automatisch beschrieben ✓
              </div>
            )}

            {/* ── Objekte & Standorte ─────────────────────────────────────── */}
            <div className="border border-border rounded-xl overflow-hidden mt-3">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border">
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-muted-foreground" />
                  <span className="text-sm font-semibold">Objekte & Standorte</span>
                  {properties.length > 0 && (
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-2 py-0.5 font-medium">{properties.length}</span>
                  )}
                </div>
                <button
                  onClick={() => setShowNewProperty(v => !v)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  <Plus size={13} /> Neues Objekt
                </button>
              </div>

              {showNewProperty && (
                <div className="px-4 py-3 border-b border-border bg-indigo-50/40 space-y-2">
                  <input
                    autoFocus
                    className="input text-sm w-full"
                    placeholder="Name (z.B. Schillerstr. 12 oder 2. OG links)"
                    value={newProp.name}
                    onChange={(e) => setNewProp(p => ({ ...p, name: e.target.value }))}
                  />
                  <AddressAutocomplete
                    value={newProp.address}
                    onChange={(addr, lat, lng) => setNewProp(p => ({ ...p, address: addr, lat: lat ?? p.lat, lng: lng ?? p.lng }))}
                    placeholder="Adresse suchen (OpenStreetMap)…"
                    inputClassName="text-sm py-2"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="input text-sm"
                      value={newProp.type}
                      onChange={(e) => setNewProp(p => ({ ...p, type: e.target.value }))}
                    >
                      {[["ort","Ort/Standort"],["haus","Haus"],["mfh","Mehrfam.haus"],["wohnung","Wohnung"],["zimmer","Zimmer/Bereich"],["gewerbe","Gewerbe"],["grundstueck","Grundstück"],["sonstiges","Sonstiges"]].map(([k,l]) => (
                        <option key={k} value={k}>{l}</option>
                      ))}
                    </select>
                    <select
                      className="input text-sm"
                      value={newProp.parent_id}
                      onChange={(e) => setNewProp(p => ({ ...p, parent_id: e.target.value }))}
                    >
                      <option value="">Kein übergeord. Objekt</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={!newProp.name.trim() || propSaving}
                      onClick={async () => {
                        setPropSaving(true);
                        const res = await fetch(`/api/tenants/${id}/properties`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "create", name: newProp.name, address: newProp.address || null, lat: newProp.lat, lng: newProp.lng, type: newProp.type, parent_id: newProp.parent_id || null }),
                        });
                        const data = await res.json();
                        if (data.ok) {
                          setProperties(p => [...p, data.property]);
                          setNewProp({ name: "", address: "", lat: null, lng: null, type: "haus", parent_id: "" });
                          setShowNewProperty(false);
                        }
                        setPropSaving(false);
                      }}
                      className="btn-primary text-xs disabled:opacity-50"
                    >
                      {propSaving ? "Speichert…" : "Erstellen"}
                    </button>
                    <button onClick={() => setShowNewProperty(false)} className="btn-ghost text-xs">Abbrechen</button>
                  </div>
                </div>
              )}

              {/* Baum-Ansicht */}
              {(() => {
                const ICONS = { ort:"📍", haus:"🏢", mfh:"🏠", wohnung:"🚪", zimmer:"🛋️", gewerbe:"🏪", grundstueck:"🌳", sonstiges:"📦" };
                function PropTreeRow({ node, depth }) {
                  const children = properties.filter(p => p.parent_id === node.id);
                  const hasChildren = children.length > 0;
                  const isExpanded = expandedProps.has(node.id);
                  const isSelected = filterProperty === node.id;
                  return (
                    <>
                      <div
                        style={{ paddingLeft: 16 + depth * 14 }}
                        className={`group flex items-center justify-between pr-3 py-2 cursor-pointer transition-colors text-xs ${isSelected ? "bg-indigo-50 text-indigo-700 font-medium" : "hover:bg-muted/40 text-muted-foreground"}`}
                        onClick={() => setFilterProperty(f => f === node.id ? null : node.id)}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {hasChildren ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedProps(s => { const n = new Set(s); n.has(node.id) ? n.delete(node.id) : n.add(node.id); return n; }); }}
                              className="text-[9px] w-4 h-4 flex items-center justify-center"
                            >
                              {isExpanded ? "▾" : "▸"}
                            </button>
                          ) : <span className="w-4" />}
                          <span>{ICONS[node.type] || "📦"}</span>
                          <span className="truncate">{node.name}</span>
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {node.image_count > 0 && <span className="text-[9px] opacity-60">{node.image_count}</span>}
                          {(node.lat || node.address) && (
                            <a href={node.lat ? `https://maps.google.com/?q=${node.lat},${node.lng}` : `https://maps.google.com/?q=${encodeURIComponent(node.address)}`}
                              target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500 hover:text-indigo-700"
                            ><MapPin size={11} /></a>
                          )}
                          <button
                            onClick={async (e) => { e.stopPropagation(); await fetch(`/api/tenants/${id}/properties`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", propertyId: node.id }) }); setProperties(ps => ps.filter(x => x.id !== node.id)); if (filterProperty === node.id) setFilterProperty(null); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-red-500 p-0.5"
                          ><X size={10} /></button>
                        </div>
                      </div>
                      {hasChildren && isExpanded && children.map(c => <PropTreeRow key={c.id} node={c} depth={depth + 1} />)}
                    </>
                  );
                }
                const roots = properties.filter(p => !p.parent_id);
                return (
                  <div className="divide-y divide-border/50">
                    <button
                      onClick={() => setFilterProperty(null)}
                      className={`w-full flex items-center justify-between px-4 py-2 text-xs transition-colors ${filterProperty === null ? "bg-indigo-50 text-indigo-700 font-medium" : "hover:bg-muted/40 text-muted-foreground"}`}
                    >
                      <span className="flex items-center gap-2"><span className="text-[10px]">🗂️</span> Alle Bilder</span>
                      <span className="text-[10px] opacity-60">{refImages.post.length}</span>
                    </button>
                    {properties.length === 0 && !showNewProperty && (
                      <div className="px-4 py-4 text-center text-xs text-muted-foreground/50">
                        Noch keine Objekte — oben "Neues Objekt" anlegen.
                      </div>
                    )}
                    {roots.map(node => <PropTreeRow key={node.id} node={node} depth={0} />)}
                  </div>
                );
              })()}
            </div>

            {/* ── Filter: Zustand ─────────────────────────────────────────── */}
            {refImages.post.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3">
                <span className="text-xs text-muted-foreground shrink-0">Filter:</span>
                {[null,"vorher","dazwischen","nachher","neutral"].map(key => {
                  const labels = { null:"Alle", vorher:"Vorher", dazwischen:"Umbau", nachher:"Nachher", neutral:"Neutral" };
                  const active = filterCondition === key;
                  return (
                    <button
                      key={String(key)}
                      onClick={() => setFilterCondition(active ? null : key)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${active ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-muted-foreground/40"}`}
                    >
                      {labels[key]}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Upload Zone ─────────────────────────────────────────────── */}
            <label
              className="flex flex-col items-center justify-center py-7 rounded-xl border-2 border-dashed border-border hover:border-emerald-400 hover:bg-emerald-50/30 cursor-pointer transition-all mt-3 mb-1"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-emerald-400", "bg-emerald-50/30"); }}
              onDragLeave={(e) => { e.currentTarget.classList.remove("border-emerald-400", "bg-emerald-50/30"); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("border-emerald-400", "bg-emerald-50/30");
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith("image/")) handlePostImageUpload(f, "", []);
              }}
            >
              <Plus size={22} className="text-muted-foreground/30 mb-2" />
              <span className="text-sm text-muted-foreground">Bild hierher ziehen oder klicken</span>
              <span className="text-[10px] text-muted-foreground/50 mt-1">JPG, PNG, WebP · max 25 MB</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePostImageUpload(f, "", []);
              }} />
            </label>

            {uploading && (
              <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
                <span className="w-4 h-4 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin" />
                Wird hochgeladen und konvertiert...
              </div>
            )}

            {/* ── Bildliste (neu) ─────────────────────────────────────────── */}
            {refImages.post.length > 0 && (() => {
              const filtered = refImages.post.filter(img => {
                if (filterProperty && img.property_id !== filterProperty) return false;
                if (filterCondition && (img.condition_tag || "neutral") !== filterCondition) return false;
                return true;
              });

              const COND_STYLE = {
                vorher:     "bg-orange-50 text-orange-700 border-orange-200",
                dazwischen: "bg-blue-50 text-blue-700 border-blue-200",
                nachher:    "bg-teal-50 text-teal-700 border-teal-200",
                neutral:    "bg-gray-50 text-gray-500 border-gray-200",
              };
              const COND_LABEL = { vorher:"Vorher", dazwischen:"Umbau", nachher:"Nachher", neutral:"Neutral" };

              return (
                <div className="space-y-1.5 mt-2">
                  {filtered.length === 0 && (
                    <p className="text-xs text-center text-muted-foreground/50 py-6">Keine Bilder mit diesen Filtern.</p>
                  )}
                  {filtered.map((img) => {
                    const prop = properties.find(p => p.id === img.property_id);
                    const isSelected = selectedImages.has(img.id);
                    const isConfirmDelete = confirmDeleteId === img.id;
                    const hasDesc = (img.description?.trim()?.length ?? 0) > 5;
                    const condKey = img.condition_tag || "neutral";
                    const hasSequence = !!img.sequence_group;

                    const isDangerHover = hoveredDeleteId === img.id && !isSelected && !isConfirmDelete;

                    return (
                      <div
                        key={img.id}
                        className={`flex gap-2.5 p-2 rounded-xl border transition-all duration-200 group cursor-pointer
                          ${isSelected
                            ? "border-indigo-400 bg-indigo-50/40 shadow-sm"
                            : isConfirmDelete
                            ? "border-red-400 bg-red-100"
                            : isDangerHover
                            ? "border-red-400 bg-red-100 shadow-sm"
                            : "border-border/60 hover:border-border hover:shadow-sm hover:bg-muted/20"
                          }`}
                        onMouseLeave={() => setHoveredDeleteId(null)}
                        onClick={() => {
                          const realIdx = refImages.post.findIndex(i => i.id === img.id);
                          setSelectedImageIdx(realIdx);
                        }}
                      >
                        {/* Checkbox (multi-select) */}
                        <div
                          className="shrink-0 flex items-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedImages(prev => {
                              const s = new Set(prev);
                              s.has(img.id) ? s.delete(img.id) : s.add(img.id);
                              return s;
                            });
                          }}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all shrink-0 mt-0.5
                            ${isSelected
                              ? "bg-indigo-600 border-indigo-600"
                              : "border-border/60 group-hover:border-muted-foreground/40"
                            }`}
                          >
                            {isSelected && <Check size={9} className="text-white" />}
                          </div>
                        </div>

                        {/* Thumbnail */}
                        <div className="relative shrink-0">
                          <img
                            src={img.thumb_url || img.image_url}
                            alt={img.description || ""}
                            className="w-24 h-16 object-cover rounded-lg"
                          />
                          {hasSequence && (
                            <span className="absolute top-0.5 left-0.5 bg-indigo-600/80 backdrop-blur-sm rounded-full p-0.5" title="Teil einer Sequenz">
                              <svg width="8" height="8" viewBox="0 0 16 16" fill="white"><path d="M8 1l2.5 4h-1.5v4h-2v-4h-1.5z"/><circle cx="8" cy="14" r="2"/></svg>
                            </span>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1">
                            {/* KI-Bereit Badge */}
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${hasDesc ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-600 border-amber-200"}`}>
                              <span className={`w-1 h-1 rounded-full ${hasDesc ? "bg-emerald-500" : "bg-amber-400"}`} />
                              {hasDesc ? "KI bereit" : "fehlt"}
                            </span>
                            {/* Raumtyp */}
                            {img.room_type && (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                                {img.room_type}
                              </span>
                            )}
                            {/* Zustand */}
                            {condKey !== "neutral" && (
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${COND_STYLE[condKey] || COND_STYLE.neutral}`}>
                                {COND_LABEL[condKey]}
                              </span>
                            )}
                            {/* Objekt */}
                            {prop && (
                              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-purple-50 text-purple-700 border border-purple-200 truncate max-w-[100px]">
                                {prop.name}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate leading-relaxed">
                            {img.description || <span className="italic opacity-50">Keine Beschreibung</span>}
                          </p>
                          {/* Tags */}
                          {(img.ai_tags?.length > 0) && (
                            <div className="flex flex-wrap gap-1">
                              {(img.ai_tags || []).slice(0, 4).map(t => (
                                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground/70">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Delete */}
                        <div className="shrink-0 flex items-center pl-1" onClick={e => e.stopPropagation()}>
                          <button
                            onMouseEnter={() => setHoveredDeleteId(img.id)}
                            onClick={() => triggerDeleteConfirm(img.id)}
                            className={`h-7 rounded-lg text-[11px] font-medium transition-all px-2 flex items-center gap-1
                              ${isConfirmDelete
                                ? "bg-red-500 text-white opacity-100 animate-pulse"
                                : isDangerHover
                                ? "opacity-100 text-red-600 bg-red-200 border border-red-300"
                                : "opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-100 border border-transparent hover:border-red-200"
                              }`}
                            title={isConfirmDelete ? "Nochmal klicken zum Bestätigen" : "Bild löschen"}
                          >
                            <Trash2 size={11} />
                            {isConfirmDelete && "Sicher?"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Floating Multi-Select Bar ───────────────────────────────────── */}
      {selectedImages.size > 0 && createPortal(
        <div
          style={{ position: "fixed", bottom: 24, left: "50%", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, animation: "floatBarIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          {/* Tag-Input Expansion */}
          {showBulkTagInput && (
            <div
              style={{ animation: "floatBarIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both" }}
              className="flex items-center gap-2 bg-card border border-border rounded-2xl shadow-2xl px-3 py-2"
            >
              <span className="text-[11px] text-muted-foreground shrink-0">
                {showBulkTagInput === "add" ? "Tag hinzufügen:" : "Tag entfernen:"}
              </span>
              <input
                autoFocus
                value={bulkTagInput}
                onChange={e => setBulkTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") showBulkTagInput === "add" ? bulkAddTag(bulkTagInput) : bulkRemoveTag(bulkTagInput);
                  if (e.key === "Escape") { setShowBulkTagInput(false); setBulkTagInput(""); }
                }}
                placeholder="z.B. küche"
                className="text-xs border border-border rounded-lg px-2 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400"
              />
              <button
                onClick={() => showBulkTagInput === "add" ? bulkAddTag(bulkTagInput) : bulkRemoveTag(bulkTagInput)}
                className={`text-xs font-medium px-2.5 py-1 rounded-lg transition-all ${showBulkTagInput === "add" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-red-500 text-white hover:bg-red-600"}`}
              >
                {showBulkTagInput === "add" ? "Hinzufügen" : "Entfernen"}
              </button>
              <button onClick={() => { setShowBulkTagInput(false); setBulkTagInput(""); }} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={13} />
              </button>
            </div>
          )}

          {/* Main Bar */}
          <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl px-3 py-2.5">
            {/* Count */}
            <div className="flex items-center gap-1.5 pr-2 mr-1 border-r border-white/15">
              <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                <span className="text-[10px] font-bold text-white leading-none">{selectedImages.size}</span>
              </div>
              <span className="text-[11px] text-white/70 whitespace-nowrap">
                {selectedImages.size === 1 ? "Bild" : "Bilder"} gewählt
              </span>
            </div>

            {/* Objekt zuordnen */}
            <select
              className="text-[11px] bg-white/10 border border-white/15 text-white rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-white/30 cursor-pointer"
              defaultValue=""
              onChange={async (e) => {
                const pid = e.target.value;
                if (!pid) return;
                await fetch(`/api/tenants/${id}/images`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "bulk_assign", imageIds: Array.from(selectedImages), propertyId: pid === "_clear" ? null : pid }),
                });
                const update = pid === "_clear" ? null : pid;
                setRefImages(prev => ({ ...prev, post: prev.post.map(img => selectedImages.has(img.id) ? { ...img, property_id: update } : img) }));
                setSelectedImages(new Set());
                loadProperties();
                e.target.value = "";
              }}
            >
              <option value="">Objekt zuordnen…</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="_clear">— Kein Objekt</option>
            </select>

            {/* Zustand */}
            <select
              className="text-[11px] bg-white/10 border border-white/15 text-white rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-white/30 cursor-pointer"
              defaultValue=""
              onChange={async (e) => {
                const tag = e.target.value;
                if (!tag) return;
                await fetch(`/api/tenants/${id}/images`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "bulk_assign", imageIds: Array.from(selectedImages), conditionTag: tag === "_clear" ? null : tag }),
                });
                const update = tag === "_clear" ? null : tag;
                setRefImages(prev => ({ ...prev, post: prev.post.map(img => selectedImages.has(img.id) ? { ...img, condition_tag: update } : img) }));
                setSelectedImages(new Set());
                e.target.value = "";
              }}
            >
              <option value="">Zustand setzen…</option>
              <option value="vorher">Vorher</option>
              <option value="dazwischen">Umbau</option>
              <option value="nachher">Nachher</option>
              <option value="neutral">Neutral</option>
              <option value="_clear">— Kein Zustand</option>
            </select>

            {/* KI-Analyse */}
            <button
              onClick={bulkAnalyze}
              className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white/10 text-white/80 hover:bg-emerald-600 hover:text-white border border-white/15 transition-all whitespace-nowrap"
            >
              KI-Analyse
            </button>

            {/* Tags */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => { setShowBulkTagInput(s => s === "add" ? false : "add"); setBulkTagInput(""); }}
                className={`text-[11px] font-medium px-2 py-1 rounded-l-lg border border-white/15 transition-all whitespace-nowrap ${showBulkTagInput === "add" ? "bg-emerald-600 text-white border-emerald-500" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                title="Tag hinzufügen"
              >
                Tag +
              </button>
              <button
                onClick={() => { setShowBulkTagInput(s => s === "remove" ? false : "remove"); setBulkTagInput(""); }}
                className={`text-[11px] font-medium px-2 py-1 rounded-r-lg border-r border-y border-white/15 transition-all whitespace-nowrap ${showBulkTagInput === "remove" ? "bg-red-500 text-white border-red-400" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                title="Tag entfernen"
              >
                −
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-5 bg-white/15 mx-0.5" />

            {/* Löschen */}
            <button
              onClick={() => {
                if (bulkDeleteConfirm) {
                  bulkDelete(Array.from(selectedImages));
                  if (bulkDeleteTimerRef.current) clearTimeout(bulkDeleteTimerRef.current);
                  setBulkDeleteConfirm(false);
                } else {
                  setBulkDeleteConfirm(true);
                  if (bulkDeleteTimerRef.current) clearTimeout(bulkDeleteTimerRef.current);
                  bulkDeleteTimerRef.current = setTimeout(() => setBulkDeleteConfirm(false), 3000);
                }
              }}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 whitespace-nowrap
                ${bulkDeleteConfirm
                  ? "bg-red-500 border-red-400 text-white animate-pulse"
                  : "bg-white/10 border-white/15 text-white/70 hover:bg-red-500/80 hover:text-white hover:border-red-400"
                }`}
            >
              <Trash2 size={11} />
              {bulkDeleteConfirm ? "Sicher?" : "Löschen"}
            </button>

            {/* Cancel */}
            <button
              onClick={() => { setSelectedImages(new Set()); setBulkDeleteConfirm(false); setShowBulkTagInput(false); }}
              className="ml-1 w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all"
              title="Auswahl aufheben"
            >
              <X size={12} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ── ImageModal ─────────────────────────────────────────────────────── */}
      {selectedImageIdx !== null && refImages.post.length > 0 && (
        <ImageModal
          images={refImages.post}
          initialIndex={selectedImageIdx}
          tenantId={id}
          properties={properties}
          onClose={() => setSelectedImageIdx(null)}
          onUpdate={handleImageUpdate}
          onDelete={handleImageDelete}
          onPropertyCreate={(p) => setProperties(prev => [p, ...prev])}
        />
      )}

      {/* Tab: Reporting */}
      {tab === "reporting" && (
        <div className="admin-card space-y-5">
          {/* Telegram */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Telegram</h3>
              <ToggleSwitch
                checked={settings.telegram_enabled || false}
                onChange={(v) => setSettings({ ...settings, telegram_enabled: v })}
              />
            </div>
            <div className={`transition-all duration-300 overflow-hidden ${settings.telegram_enabled ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Bot Token" value={settings.telegram_bot_token} onChange={(v) => setSettings({ ...settings, telegram_bot_token: v })} type="password" />
                <FormField label="Chat ID" value={settings.telegram_chat_id} onChange={(v) => setSettings({ ...settings, telegram_chat_id: v })} />
              </div>
            </div>
          </div>

          <hr className="border-border" />

          {/* E-Mail */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">E-Mail</h3>
              <ToggleSwitch
                checked={settings.email_enabled || false}
                onChange={(v) => setSettings({ ...settings, email_enabled: v })}
              />
            </div>
            <div className={`transition-all duration-300 overflow-hidden ${settings.email_enabled ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
              <FormField label="Report E-Mail" value={settings.report_email} onChange={(v) => setSettings({ ...settings, report_email: v })} placeholder="info@beispiel.de" />
            </div>
          </div>

          <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Tab: Posts */}
      {tab === "posts" && (
        <div className="space-y-4">
          {tenantPosts === null ? (
            <div className="admin-card animate-pulse space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-14 bg-muted rounded" />)}
            </div>
          ) : tenantPosts.length === 0 ? (
            <div className="admin-card text-center text-muted-foreground py-10">Noch keine Posts.</div>
          ) : (
            <div className="admin-card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="w-[88px] p-0"></th>
                    <th className="text-left px-3 py-3 font-medium text-muted-foreground">Titel</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Kategorie</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Sprache</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Wörter</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Bilder</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">QA</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Datum</th>
                    <th className="px-3 py-3 hidden lg:table-cell w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {tenantPosts.map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() => loadPostPreview(p.id)}
                      className="border-b border-border/40 hover:bg-muted/30 cursor-pointer transition-colors group/row"
                    >
                      {/* Thumbnail — fade-blend nach rechts via mask-image */}
                      <td className="p-0 w-[88px] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div
                          className="relative h-[56px] w-[88px] cursor-pointer group/img"
                          onClick={(e) => {
                            e.stopPropagation();
                            const regenPrice = billingData?.pricing?.image_regen_price_cents ?? 100;
                            setRegenModal({ postId: p.id, postTitle: p.blog_title, imageUrl: p.image_url, regenPrice });
                          }}
                        >
                          {p.image_url ? (
                            <>
                              <img
                                src={p.image_url}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover"
                                style={{ WebkitMaskImage: "linear-gradient(to right, black 45%, transparent 100%)", maskImage: "linear-gradient(to right, black 45%, transparent 100%)" }}
                              />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center rounded-sm" title="Bild neu generieren"
                                style={{ WebkitMaskImage: "linear-gradient(to right, black 45%, transparent 100%)", maskImage: "linear-gradient(to right, black 45%, transparent 100%)" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
                                </svg>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 bg-red-50 flex items-center justify-center" title="Kein Bild — klicken zum Generieren">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-red-300">
                                <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-foreground line-clamp-1">{p.blog_title}</span>
                        {p.is_test && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">Test</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{p.category}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">{p.language}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
                        {p.word_count != null ? p.word_count.toLocaleString("de") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">{p.image_count ?? "—"}</td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        {p.qa_score != null ? (
                          <span
                            title={p.qa_issues?.length ? p.qa_issues.join("\n") : "Keine Issues"}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold cursor-help ${
                              p.qa_score >= 8 ? "bg-emerald-100 text-emerald-700"
                              : p.qa_score >= 5 ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                            }`}
                          >{p.qa_score}</span>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={
                          p.status === "published" ? "badge badge-success"
                          : p.status === "exported" ? "badge" + " " + "bg-blue-100 text-blue-700 border-blue-200"
                          : p.status === "draft" ? "badge badge-warning"
                          : p.status === "failed" ? "badge badge-error"
                          : "badge badge-neutral"
                        }>{p.status === "exported" ? "exportiert" : p.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(p.created_at).toLocaleDateString("de")}
                      </td>
                      <td className="px-3 py-3 hidden lg:table-cell" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleExportHtml(p.id, p.blog_title)}
                          className="dw-icon-btn"
                          title="Als HTML exportieren"
                        >
                          <Download size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {/* Tab: GBP */}
      {tab === "google" && (
        <div className="space-y-6">
          {googleLoading && (
            <div className="admin-card flex items-center gap-3 text-muted-foreground">
              <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              Verbindungsstatus wird geladen…
            </div>
          )}

          {!googleLoading && (
            <>
              {/* Google Unternehmensprofil — OAuth */}
              <div className="admin-card space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Google Unternehmensprofil — Auto-Post</h3>
                    <p className="text-sm text-muted-foreground">Nach jedem generierten Post automatisch auf Google posten (Bild + Text).</p>
                  </div>
                  {googleStatus?.gbpConnected && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div
                        className={`relative w-10 h-5 rounded-full transition-colors ${googleStatus.gbpEnabled ? "bg-primary" : "bg-muted"}`}
                        onClick={async () => {
                          const enabled = !googleStatus.gbpEnabled;
                          await googleAction("toggle_gbp", { enabled });
                          setGoogleStatus(s => ({ ...s, gbpEnabled: enabled }));
                        }}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${googleStatus.gbpEnabled ? "left-5" : "left-0.5"}`} />
                      </div>
                      <span className="text-sm">{googleStatus.gbpEnabled ? "Aktiv" : "Deaktiviert"}</span>
                    </label>
                  )}
                </div>

                {!googleStatus?.gbpConnected ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Verbinde dein Google-Konto um automatisch auf dein Unternehmensprofil zu posten.</p>
                    <a
                      href={`/api/auth/google/start?tenantId=${id}`}
                      className="btn-primary inline-flex items-center gap-2 text-sm"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                      Mit Google verbinden
                    </a>
                    {googleStatus?.tokenError && (
                      <p className="text-xs text-destructive">{googleStatus.tokenError}</p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Verbunden-Status */}
                    <div className="flex items-center justify-between p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <div className="flex items-center gap-2 text-xs text-emerald-700">
                        <span>✓</span>
                        <span>Google Konto verbunden</span>
                      </div>
                      <div className="flex gap-2">
                        <a href={`/api/auth/google/start?tenantId=${id}`} className="btn-ghost text-xs">Neu verbinden</a>
                        <button className="btn-ghost text-xs text-destructive" onClick={async () => {
                          await googleAction("disconnect");
                          setGoogleStatus(s => ({ ...s, gbpConnected: false, gbpEnabled: false }));
                          showMsg("GBP-Verbindung getrennt");
                        }}>Trennen</button>
                      </div>
                    </div>

                    {/* Account + Location Picker */}
                    {googleStatus.gbpAccounts?.length > 0 ? (
                      <div className="space-y-3">
                        {googleStatus.gbpAccounts.map(acc => (
                          <div key={acc.name} className="border rounded-lg p-3 space-y-2">
                            <p className="font-medium text-sm">{acc.accountName || acc.name}</p>
                            {acc.locations?.length > 0 ? (
                              <div className="grid grid-cols-1 gap-1">
                                {acc.locations.map(loc => {
                                  const accountId = acc.name.split("/").pop();
                                  const locationId = loc.name.split("/").pop();
                                  const isActive = googleStatus.gbpAccountId === accountId && googleStatus.gbpLocationId === locationId;
                                  return (
                                    <button
                                      key={loc.name}
                                      className={`text-left text-sm px-3 py-2 rounded-md transition-colors ${isActive ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"}`}
                                      onClick={async () => {
                                        await googleAction("set_gbp", { accountId, locationId });
                                        setGoogleStatus(s => ({ ...s, gbpAccountId: accountId, gbpLocationId: locationId }));
                                        showMsg("Standort gespeichert");
                                      }}
                                    >
                                      {loc.title || locationId} {isActive && "✓"}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">Keine Standorte gefunden</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {googleStatus.tokenError
                          ? "Token-Fehler — bitte neu verbinden"
                          : "Keine GBP-Accounts gefunden. Konto hat möglicherweise kein Unternehmensprofil."}
                      </p>
                    )}

                    {googleStatus.gbpAccountId && googleStatus.gbpLocationId && (
                      <div className="flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-lg">
                        <span>✓</span>
                        <span>Aktiver Standort: <strong>{googleStatus.gbpLocationId}</strong></span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Manuell posten */}
              {googleStatus?.gbpConnected && googleStatus?.gbpAccountId && googleStatus?.gbpLocationId && tenantPosts?.length > 0 && (
                <div className="admin-card space-y-3">
                  <h3 className="font-semibold">Manuell auf Google posten</h3>
                  <p className="text-sm text-muted-foreground">Einen vorhandenen Post jetzt auf Google Unternehmensprofil veröffentlichen.</p>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {tenantPosts.filter(p => p.status !== "failed").map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-3 p-2 border rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.blog_title}</p>
                          <p className="text-xs text-muted-foreground">{p.language} · {p.status}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {p.gbp_post_id && <span className="text-xs text-emerald-600 font-medium">Gepostet ✓</span>}
                          <button
                            className="btn-secondary text-xs py-1"
                            disabled={gbpPostLoading === p.id}
                            onClick={async () => {
                              setGbpPostLoading(p.id);
                              const res = await googleAction("post_to_gbp", { postId: p.id });
                              setGbpPostLoading(null);
                              if (res.ok) showMsg("Erfolgreich auf Google gepostet ✓");
                              else showMsg(res.error || "Fehler beim Posten", "error");
                              loadTenantPosts();
                            }}
                          >
                            {gbpPostLoading === p.id ? "Postet…" : p.gbp_post_id ? "Erneut posten" : "Jetzt posten"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: Zugänge */}
      {tab === "users" && (
        <div className="admin-card space-y-6">
          <div>
            <h3 className="font-semibold mb-3">Neuen Zugang anlegen</h3>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="E-Mail" value={newUser.email} onChange={(v) => setNewUser({ ...newUser, email: v })} placeholder="kunde@beispiel.de" />
              <FormField label="Name (optional)" value={newUser.name} onChange={(v) => setNewUser({ ...newUser, name: v })} placeholder="Max Mustermann" />
              <FormField label="Passwort" value={newUser.password} onChange={(v) => setNewUser({ ...newUser, password: v })} type="password" />
            </div>
            <button onClick={createCustomerUser} className="btn-primary mt-3" disabled={saving || !newUser.email || !newUser.password}>
              Zugang erstellen
            </button>
          </div>
          <hr className="border-border" />
          <div>
            <h3 className="font-semibold mb-3">Bestehende Zugänge</h3>
            {users.length > 0 ? (
              <div className="space-y-2">
                {users.map((u) => {
                  const isEditing = editingUserId === u.id;
                  const isDangerHover = hoveredDeleteUserId === u.id;
                  return (
                    <div
                      key={u.id}
                      className={`rounded-xl border transition-all duration-200 overflow-hidden
                        ${isDangerHover && !isEditing
                          ? "border-red-300 bg-red-50/60"
                          : isEditing
                          ? "border-indigo-300 bg-indigo-50/30"
                          : "border-border bg-muted/30 hover:border-border/80"
                        }`}
                    >
                      {/* Header Row */}
                      <div className="flex items-center justify-between py-3 px-4">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{u.email}</p>
                          <p className="text-xs text-muted-foreground">{u.name || "Kein Name"} &middot; Erstellt: {new Date(u.created_at).toLocaleDateString("de")}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-3">
                          <button
                            onClick={() => {
                              if (isEditing) { setEditingUserId(null); return; }
                              setEditingUserId(u.id);
                              setEditUserData({ email: u.email, name: u.name || "", password: "" });
                            }}
                            className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all border
                              ${isEditing
                                ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                                : "border-transparent text-muted-foreground hover:bg-muted hover:border-border"
                              }`}
                            title={isEditing ? "Abbrechen" : "Bearbeiten"}
                          >
                            {isEditing ? <X size={13} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
                          </button>
                          <div
                            onMouseEnter={() => setHoveredDeleteUserId(u.id)}
                            onMouseLeave={() => setHoveredDeleteUserId(null)}
                          >
                            <button
                              onClick={() => deleteCustomerUser(u.id)}
                              className="h-7 w-7 rounded-lg flex items-center justify-center transition-all border border-transparent text-red-500 hover:bg-red-100 hover:border-red-200"
                              title="Zugang löschen"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Edit Panel */}
                      {isEditing && (
                        <div className="px-4 pb-4 border-t border-indigo-200/60 pt-3 space-y-3">
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">E-Mail</label>
                              <input
                                className="w-full text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 bg-white transition-all"
                                value={editUserData.email}
                                onChange={e => setEditUserData(d => ({ ...d, email: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Name</label>
                              <input
                                className="w-full text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 bg-white transition-all"
                                value={editUserData.name}
                                onChange={e => setEditUserData(d => ({ ...d, name: e.target.value }))}
                                placeholder="Max Mustermann"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Neues Passwort <span className="text-muted-foreground/50">(optional)</span></label>
                              <input
                                type="password"
                                className="w-full text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:border-indigo-400 bg-white transition-all"
                                value={editUserData.password}
                                onChange={e => setEditUserData(d => ({ ...d, password: e.target.value }))}
                                placeholder="Leer lassen = unverändern"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateCustomerUser(u.id)}
                              disabled={saving || !editUserData.email}
                              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-1.5"
                            >
                              <Save size={11} />
                              Speichern
                            </button>
                            <button
                              onClick={() => setEditingUserId(null)}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Noch keine Kundenzugänge angelegt.</p>
            )}
          </div>
        </div>
      )}

      {/* Tab: Client-Integration */}
      {tab === "client" && (
        <div className="space-y-6">
          {/* Client Push API */}
          <div className="admin-card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Content Push (Webhook)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Nach jeder Veröffentlichung sendet Ghostwriter den Post automatisch an die Website des Kunden.
                </p>
              </div>
              <ToggleSwitch
                checked={settings.client_push_enabled || false}
                onChange={(v) => setSettings({ ...settings, client_push_enabled: v })}
              />
            </div>
            <div className={`transition-all duration-300 overflow-hidden ${settings.client_push_enabled ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"}`}>
              <div className="space-y-3 pt-1">
                <FormField
                  label="Webhook URL"
                  value={settings.client_api_url}
                  onChange={(v) => setSettings({ ...settings, client_api_url: v })}
                  placeholder="https://meinewebsite.de/api/ghostwriter"
                />
                <div className="form-group">
                  <label className="form-label">API Key (Bearer Token)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="form-input flex-1 text-sm font-mono"
                      value={settings.client_api_key || ""}
                      onChange={(e) => setSettings({ ...settings, client_api_key: e.target.value })}
                      placeholder="Automatisch generiert oder manuell"
                    />
                    {settings.client_api_key && (
                      <CopyButton text={settings.client_api_key} className="flex-shrink-0 h-9 w-9 border border-border rounded-lg" />
                    )}
                    <button
                      type="button"
                      className="btn-outline text-xs flex-shrink-0"
                      onClick={() => setSettings({ ...settings, client_api_key: crypto.randomUUID() })}
                    >
                      Generieren
                    </button>
                  </div>
                </div>
                <div className="text-xs">
                  <p className="font-medium mb-1.5">Payload (POST an Webhook):</p>
                  <CodeBlock text={`{ "event": "post_published", "post": { "id": "...", "title": "...", "slug": "...", "body_html": "...", "language": "de", "url": "https://..." } }`}>
                    {`{ "event": "post_published", "post": { "id": "...", "title": "...", "slug": "...", "body_html": "...", "language": "de", "url": "https://..." } }`}
                  </CodeBlock>
                </div>
              </div>
            </div>
          </div>

          {/* Blog-Widget Embed */}
          <div className="admin-card space-y-3">
            <div>
              <h3 className="font-semibold">Blog-Widget Embed</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Zeigt die letzten Blog-Posts auf jeder beliebigen Website an — kein Backend nötig.
              </p>
            </div>
            {(() => {
              const base = typeof window !== "undefined" ? window.location.origin : "";
              const embedCode = `<div id="gw-blog"></div>\n<script src="${base}/api/public/${tenant?.slug}/embed.js?lang=de&limit=5&style=cards"></script>`;
              return <CodeBlock text={embedCode}>{embedCode}</CodeBlock>;
            })()}
            <p className="text-xs text-muted-foreground">
              Parameter: <code className="bg-muted px-1 rounded">lang</code> = Sprache &nbsp;·&nbsp; <code className="bg-muted px-1 rounded">limit</code> = Anzahl &nbsp;·&nbsp; <code className="bg-muted px-1 rounded">style</code> = cards | list | minimal
            </p>
          </div>

          {/* Public API */}
          <div className="admin-card space-y-3">
            <div>
              <h3 className="font-semibold">Public API</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Posts als JSON — öffentlich, kein API-Key nötig.</p>
            </div>
            <div className="space-y-2">
              {[
                `/api/public/${tenant?.slug}/de/posts`,
                `/api/public/${tenant?.slug}/de/posts/[slug]`,
              ].map((endpoint) => (
                <div key={endpoint} className="relative group flex items-center gap-3 font-mono text-xs bg-muted/40 border border-border rounded-lg px-4 py-2.5 pr-10">
                  <span className="text-emerald-600 font-bold flex-shrink-0">GET</span>
                  <span className="text-muted-foreground">{endpoint}</span>
                  <div className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={typeof window !== "undefined" ? `${window.location.origin}${endpoint}` : endpoint} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
        </div>
      )}

      {/* Test-Post Modal */}
      {showTestModal && (
        <div className="dw-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowTestModal(false); }}>
          <div className="dw-modal" style={{ width: "min(480px, 90vw)", position: "relative" }}>
            <button className="dw-icon-btn" onClick={() => setShowTestModal(false)} style={{ position: "absolute", top: 12, right: 12 }}>
              <X size={16} />
            </button>
            <div className="p-5">
              <div className="flex items-start justify-between mb-1 gap-3">
                <h2 className="text-lg font-semibold">Test-Post erstellen</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Test-Posts werden als Draft gespeichert und zählen nicht für die Duplikat-Vermeidung.
              </p>

              {/* Mode Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    testMode === "random" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setTestMode("random")}
                >
                  <Shuffle size={14} /> Zufällig
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    testMode === "manual" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => setTestMode("manual")}
                >
                  Manuell wählen
                </button>
              </div>

              {testMode === "manual" && (
                <div className="space-y-3 mb-4">
                  <div className="form-group">
                    <label className="form-label">Kategorie</label>
                    <select
                      className="form-select"
                      value={testCatIdx}
                      onChange={(e) => { setTestCatIdx(parseInt(e.target.value)); setTestAngleIdx(0); }}
                    >
                      {topics.filter(t => t.is_active !== false).map((t, i) => (
                        <option key={i} value={i}>{t.label || `Kategorie ${i}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Angle</label>
                    <select className="form-select" value={testAngleIdx} onChange={(e) => setTestAngleIdx(parseInt(e.target.value))}>
                      {(topics.filter(t => t.is_active !== false)[testCatIdx]?.angles || DEFAULT_ANGLES)
                        .filter(a => a.active !== false)
                        .map((a, i) => (
                          <option key={i} value={i}>{a.label}</option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Pipeline-Fortschritt + Timer */}
              {(testRunning && testStep > 0) && (() => {
                const estimated = settings.avg_pipeline_ms ? Math.round(settings.avg_pipeline_ms * 1.1) : null;
                const progress = estimated ? Math.min(testElapsedMs / estimated, 0.97) : null;
                const remainMs = estimated ? Math.max(estimated - testElapsedMs, 0) : null;
                const dots = [".","..","...","..","." ][dotPhase];
                return (
                  <div className="mb-4 space-y-3">
                    {/* Timer-Zeile */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 tabular-nums font-mono">
                        <Timer size={12} className="flex-shrink-0" />
                        {fmtMs(testElapsedMs)}
                        {estimated !== null && (
                          <span className="text-muted-foreground/50">/ ca. {fmtMs(estimated)}</span>
                        )}
                      </span>
                      <span className="tabular-nums font-mono tracking-widest text-primary/60 w-6 text-right">{dots}</span>
                    </div>
                    {/* Fortschrittsbalken */}
                    {progress !== null && (
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${progress * 100}%` }}
                        />
                      </div>
                    )}
                    {/* Steps */}
                    <div className="space-y-1.5">
                      {[
                        { s: 1, label: "Profil wird analysiert" },
                        { s: 2, label: "Thema & Blickwinkel werden gewählt" },
                        { s: 3, label: "SEO-Keywords werden recherchiert" },
                        { s: 4, label: "Artikel wird geschrieben" },
                        { s: 5, label: "Bilder werden generiert" },
                        { s: 6, label: "Qualitätsprüfung läuft" },
                        { s: 7, label: "Artikel wird optimiert" },
                      ].map(({ s, label }) => (
                        <div key={s} className={`flex items-center gap-2 text-sm transition-all duration-300 ${
                          testStep === s ? "text-foreground font-medium" : testStep > s ? "text-emerald-600" : "text-muted-foreground/30"
                        }`}>
                          <span className="w-4 flex-shrink-0 text-center">
                            {testStep > s ? "✓" : testStep === s ? (
                              <span className="inline-block w-3 h-3 border-2 border-violet-400 border-t-violet-600 rounded-full animate-spin" />
                            ) : "·"}
                          </span>
                          <span className="tabular-nums">
                            {label}
                            {testStep === s && (
                              <span className="inline-block w-6 text-left font-mono tracking-widest">{dots}</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Ergebnis */}
              {testResult && testStep === 6 && (() => {
                const fmtDuration = (ms) => ms ? ` · ${fmtMs(ms)}` : "";
                return (
                <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                  <p className="text-sm font-medium text-emerald-800 mb-1">Draft erstellt</p>
                  <p className="text-sm text-emerald-700 font-semibold">{testResult.title}</p>
                  <p className="text-xs text-emerald-600 mt-1">
                    Status: {testResult.status} · Sprache: {testResult.language}{fmtDuration(testResult.durationMs)}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <a
                      href={`/${tenant.slug}/${testResult.language}/blog/${testResult.slug}`}
                      target="_blank"
                      className="btn-primary text-xs"
                    >
                      Anschauen
                    </a>
                    <button onClick={() => { setShowTestModal(false); setTestStep(0); setTestResult(null); }} className="btn-outline text-xs">Schließen</button>
                  </div>
                </div>
                );
              })()}

              {/* Start Button — nur wenn nicht läuft und kein Ergebnis */}
              {!testRunning && !testResult && (
                <button onClick={runTestPost} className="btn-ai w-full justify-center">
                  <FlaskConical size={14} />
                  {testMode === "random" ? "Zufälligen Test-Post erstellen" : "Test-Post erstellen"}
                </button>
              )}

              {/* Nochmal Button nach Ergebnis */}
              {testResult && (
                <button onClick={() => { setTestResult(null); setTestStep(0); }} className="btn-ai-outline w-full justify-center mt-2">
                  <FlaskConical size={14} /> Weiteren Test-Post erstellen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Scheduling */}
      {tab === "scheduling" && (() => {
        const days = Math.round((settings.frequency_hours || 72) / 24);
        const pct = ((days - 1) / 29) * 100;
        return (
          <div className="admin-card space-y-6">
            {/* Frequenz Slider smooth + animierte Zahl */}
            <div>
              <label className="form-label">Frequenz</label>
              <div className="relative mt-2 mb-6">
                {/* Schwebende Tooltip-Blase */}
                <div
                  className="absolute -top-9 pointer-events-none"
                  style={{
                    left: `${pct}%`,
                    transform: "translateX(-50%)",
                    transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                  }}
                >
                  <div className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap"
                    style={{ transition: "transform 0.2s ease" }}>
                    <SliderCount value={days} />
                  </div>
                  <div className="w-0 h-0 mx-auto border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-primary" />
                </div>
                {/* Custom Slider Track */}
                <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="absolute h-full rounded-full bg-primary"
                    style={{
                      width: `${pct}%`,
                      transition: "width 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={1} max={30} step={1}
                  value={days}
                  onChange={(e) => setSettings({ ...settings, frequency_hours: parseInt(e.target.value) * 24 })}
                  className="absolute inset-0 w-full h-2 opacity-0 cursor-pointer"
                  style={{ top: "0" }}
                />
                {/* Thumb */}
                <div
                  className="absolute top-[-3px] w-4 h-4 rounded-full bg-white border-[3px] border-primary shadow-md pointer-events-none"
                  style={{
                    left: `${pct}%`,
                    transform: "translateX(-50%)",
                    transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-1">
                <span>Täglich</span>
                <span>Wöchentlich</span>
                <span>Monatlich</span>
              </div>
            </div>

            <hr className="border-border" />

            {/* Post-Länge */}
            <div>
              <label className="form-label mb-2 block">Post-Länge</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { key: "short",    label: "Kurz",        sub: "500–800 Wörter" },
                  { key: "medium",   label: "Standard",    sub: "800–1200 Wörter" },
                  { key: "long",     label: "Lang",        sub: "1200–1800 Wörter" },
                  { key: "detailed", label: "Ausführlich", sub: "1800–2500 Wörter" },
                ].map(({ key, label, sub }) => {
                  const active = (settings.post_length || "medium") === key;
                  return (
                    <label
                      key={key}
                      className={`radio-option flex flex-col items-center gap-1 p-3 rounded-lg border-2 cursor-pointer text-center transition-all ${
                        active ? "radio-option-active border-emerald-400 bg-emerald-50" : "border-border hover:border-border/80"
                      }`}
                      onClick={() => setSettings({ ...settings, post_length: key })}
                    >
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mb-0.5 ${active ? "border-emerald-500" : "border-gray-300"}`}>
                        <span className={`w-2 h-2 rounded-full transition-all ${active ? "bg-emerald-500 scale-100" : "bg-transparent scale-0"}`} />
                      </span>
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-[10px] text-muted-foreground">{sub}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <hr className="border-border" />

            {/* Autopilot Radio */}
            <div>
              <label className="form-label">Autopilot</label>
              <div className="space-y-2">
                <label
                  className={`radio-option flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
                    settings.is_active
                      ? "radio-option-active border-emerald-400 bg-emerald-50"
                      : "border-border"
                  }`}
                  onClick={() => setSettings({ ...settings, is_active: true })}
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    settings.is_active ? "border-emerald-500" : "border-gray-300"
                  }`}>
                    <span className={`w-2.5 h-2.5 rounded-full transition-all ${
                      settings.is_active ? "bg-emerald-500 scale-100" : "bg-transparent scale-0"
                    }`} />
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Aktiv</p>
                    <p className="text-xs text-muted-foreground">Posts werden automatisch generiert und veröffentlicht</p>
                  </div>
                </label>
                <label
                  className={`radio-option flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
                    !settings.is_active
                      ? "radio-option-active-alt border-amber-400 bg-amber-50"
                      : "border-border"
                  }`}
                  onClick={() => setSettings({ ...settings, is_active: false })}
                >
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    !settings.is_active ? "border-amber-500" : "border-gray-300"
                  }`}>
                    <span className={`w-2.5 h-2.5 rounded-full transition-all ${
                      !settings.is_active ? "bg-amber-500 scale-100" : "bg-transparent scale-0"
                    }`} />
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Pausiert</p>
                    <p className="text-xs text-muted-foreground">Keine automatischen Posts, nur manuell oder Test</p>
                  </div>
                </label>
              </div>
            </div>

            {settings.next_run_at && (
              <p className="text-sm text-muted-foreground">
                Nächster Run: {new Date(settings.next_run_at).toLocaleString("de")}
              </p>
            )}
            <button onClick={saveSettings} className="btn-primary" disabled={saving}><Save size={14} /> Speichern</button>
          </div>
        );
      })()}

      {/* Post Preview Modal — global, 2 Tabs: Post & Blog */}
      {postPreview && typeof document !== "undefined" && createPortal(
        <PostPreviewModal post={postPreview} tenantSlug={tenant?.slug} onClose={() => setPostPreview(null)} />,
        document.body
      )}

      {/* Bild-Regenerierungs-Modal */}
      {regenModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Preview */}
            {regenModal.imageUrl ? (
              <div className="relative">
                <img src={regenModal.imageUrl} alt="" className="w-full h-36 object-cover" />
                {regenLoading && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <p className="text-white text-xs">Bild wird generiert…</p>
                    </div>
                  </div>
                )}
              </div>
            ) : regenLoading ? (
              <div className="h-36 bg-muted flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : (
              <div className="h-36 bg-muted flex items-center justify-center text-muted-foreground text-sm">Kein Bild</div>
            )}
            <div className="p-5">
              <h3 className="font-semibold text-sm mb-1">Bild neu generieren</h3>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{regenModal.postTitle}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-indigo-600">
                  {((regenModal.regenPrice ?? 100) / 100).toFixed(2)} €
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setRegenModal(null)}
                    disabled={regenLoading}
                    className="btn-ghost text-sm"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={regenerateImage}
                    disabled={regenLoading}
                    className="btn-primary text-sm"
                  >
                    {regenLoading ? "Generiert…" : "Generieren"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* HTML Export Modal — Test-Post Upgrade */}
      {exportModal && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setExportModal(null)}>
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <h3 className="font-semibold mb-3">HTML Export</h3>
              <div className="p-3 rounded-lg bg-violet-50 border border-violet-200 mb-4">
                <p className="text-sm font-medium text-violet-800">Test-Post → Vollversion</p>
                <p className="text-xs text-violet-700 mt-1">
                  Dieser Test-Post wird beim Export zur Vollversion aufgewertet. Bereits gezahlte Test-Kosten werden angerechnet.
                </p>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{exportModal.postTitle}</p>
              <div className="flex items-center justify-between mb-5">
                <span className="text-sm text-muted-foreground">Aufpreis:</span>
                <span className="text-lg font-bold text-violet-700">{((exportModal.upgradeCents || 0) / 100).toFixed(2)} €</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setExportModal(null)} className="btn-ghost flex-1">Abbrechen</button>
                <button onClick={confirmExportUpgrade} className="btn-primary flex-1">
                  <Download size={13} /> Exportieren
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none ${
        checked ? "bg-emerald-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function SliderCount({ value }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;
    prevRef.current = to;
    const start = performance.now();
    const dur = 300;
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * ease));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <>{display === 1 ? "Jeden Tag" : `Alle ${display} Tage`}</>;
}

function PostPreviewModal({ post, tenantSlug, onClose }) {
  const [tab, setTab] = useState("blog");
  return (
    <div className="fixed inset-0 z-[9998] flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl my-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-0">
          <div className="flex-1 pr-4">
            <h2 className="text-lg font-semibold">{post.blog_title}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">{post.category}</span>
              {post.angle && <span className="text-xs text-muted-foreground">· {post.angle}</span>}
              <span className={
                post.status === "published" ? "badge badge-success"
                : post.status === "exported" ? "badge bg-blue-100 text-blue-700 border-blue-200"
                : post.status === "failed" ? "badge badge-error"
                : "badge badge-warning"
              }>{post.status === "exported" ? "exportiert" : post.status}</span>
              {post.is_test && <span className="badge" style={{background:"#ede9fe",color:"#7c3aed"}}>Test</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none w-8 h-8 flex items-center justify-center">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-6 mt-4 border-b border-border">
          {[{ key: "blog", label: "📝 Blog" }, { key: "post", label: "📣 Post / GBP" }].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >{t.label}</button>
          ))}
        </div>

        {/* Tab: Blog */}
        {tab === "blog" && (
          <>
            {post.image_url && (
              <div className="px-6 pt-4">
                <img src={post.image_url} alt="" className="w-full h-52 object-cover rounded-xl" />
              </div>
            )}
            <div className="p-6 blog-prose" dangerouslySetInnerHTML={{ __html: post.blog_body || "<p class='text-muted-foreground'>Kein Inhalt</p>" }} />
          </>
        )}

        {/* Tab: Post / GBP */}
        {tab === "post" && (
          <div className="p-6 space-y-4">
            {post.image_url && (
              <img src={post.image_url} alt="" className="w-full rounded-xl object-cover" style={{maxHeight: "280px"}} />
            )}
            <div className="bg-muted/40 rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {post.gbp_text || post.blog_title}
            </div>
            <p className="text-xs text-muted-foreground text-center">So sieht es auf Google Business / Social aus</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/20 rounded-b-xl">
          <span className="text-xs text-muted-foreground">{new Date(post.created_at).toLocaleString("de")}</span>
          <a href={`/${tenantSlug}/${post.language}/blog/${post.blog_slug}`} target="_blank" className="btn-primary text-xs">
            Im Blog öffnen
          </a>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text, className = "" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`dw-icon-btn transition-colors ${copied ? "text-emerald-500" : ""} ${className}`}
      title={copied ? "Kopiert!" : "Kopieren"}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function CodeBlock({ children, text, className = "" }) {
  return (
    <div className={`relative group ${className}`}>
      <pre className="text-[11px] font-mono bg-muted/40 border border-border rounded-lg px-4 py-3 overflow-x-auto text-muted-foreground leading-relaxed pr-10">{children}</pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={text || (typeof children === "string" ? children : "")} />
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text", textarea = false }) {
  const Component = textarea ? "textarea" : "input";
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <Component
        type={type}
        className={textarea ? "form-textarea" : "form-input"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
