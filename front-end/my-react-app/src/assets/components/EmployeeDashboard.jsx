import React, { useEffect, useRef, useState, useLayoutEffect } from "react";

/* ─── Google Fonts injected once ─── */
const injectFonts = () => {
  if (document.getElementById("ed-fonts")) return;
  const link = document.createElement("link");
  link.id = "ed-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Syne:wght@700&display=swap";
  document.head.appendChild(link);
};

/* ─── Helpers ─── */
const initials = (name = "") =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatMessageTime = (value) =>
  new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

/* ─── Main Component ─── */

const EmployeeDashboard = () => {
  injectFonts();

  const employeeId = localStorage.getItem("user_id");
  const employeeName = localStorage.getItem("username") || "Employee";
  const token = localStorage.getItem("token");

  const apiFetch = (url, options = {}) =>
    window.fetch(url, {
      ...options,
      headers: {
        Authorization: `Token ${token}`,
        ...(options.headers || {}),
      },
    });

  const [works, setWorks] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [selectedManager, setSelectedManager] = useState("");
  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageSending, setMessageSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [contactSummaries, setContactSummaries] = useState({});
  const [notification, setNotification] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageBody, setEditingMessageBody] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [taskActionModal, setTaskActionModal] = useState(null); // { task, type: 'accept' | 'complete' }
  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectedManagerRef = useRef("");
  const messageRequestRef = useRef(0);
  const prevPendingRef = useRef(0);
  const messagesEndRef = useRef(null);
  const lastMsgCountRef = useRef(0);
  const lastSelectionRef = useRef("");
  const needsScrollRef = useRef(false);
  const scrollContainerRef = useRef(null);

  const counts = {
    pending: works.filter((w) => w.status === "pending").length,
    in_progress: works.filter((w) => w.status === "in_progress").length,
    completed: works.filter((w) => w.status === "completed").length,
  };

  const uncompletedCount = counts.pending + counts.in_progress;

  // Deadline calculation
  const deadlineInfo = (() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const overdue = [];
    const today = [];
    const day1 = [];
    const day2 = [];

    works.forEach(w => {
      if (w.status === "completed" || !w.completion_date) return;
      const dueDate = new Date(w.completion_date);
      dueDate.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) overdue.push(w);
      else if (diffDays === 0) today.push(w);
      else if (diffDays === 1) day1.push(w);
      else if (diffDays === 2) day2.push(w);
    });

    return { overdue, today, day1, day2 };
  })();

  useEffect(() => {
    verifySession();
    fetchWorks();
    fetchContacts();
    fetchUnreadCount();
    fetchContactSummaries();

    const dataTimer = setInterval(() => {
      fetchUnreadCount();
      fetchContactSummaries();
      fetchWorks({ silent: true });
    }, 5000);

    // Load today's dismissals
    const todayStr = new Date().toISOString().slice(0, 10);
    const saved = localStorage.getItem(`dismissed_deadlines_${todayStr}`);
    if (saved) setDismissedAlerts(JSON.parse(saved));

    return () => clearInterval(dataTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedManager) {
      needsScrollRef.current = true;
      fetchMessages(selectedManager);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManager, activeTab]);

  useEffect(() => {
    selectedManagerRef.current = selectedManager;
  }, [selectedManager]);

  useEffect(() => {
    if (!selectedManager) return;

    const messageTimer = setInterval(() => {
      fetchMessages(selectedManager, { silent: true });
    }, 3000);

    return () => clearInterval(messageTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManager]);

  useEffect(() => {
    if (!selectedManager || activeTab !== "messages") return;

    const isNewMessage = messages.length > lastMsgCountRef.current;

    if (needsScrollRef.current || isNewMessage) {
      const doScroll = () => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      };

      doScroll();
      requestAnimationFrame(doScroll);
      setTimeout(doScroll, 50);
      setTimeout(doScroll, 150);

      if (needsScrollRef.current && !messageLoading && messages.length > 0) {
        needsScrollRef.current = false;
      }
      lastMsgCountRef.current = messages.length;
    }
  }, [messages, selectedManager, messageLoading, activeTab]);

  useEffect(() => {
    if (counts.pending > prevPendingRef.current) {
      notify(`New task assigned! You have ${counts.pending} pending.`);
    }
    prevPendingRef.current = counts.pending;
  }, [counts.pending]);

  /* ── API calls ── */

  const verifySession = async () => {
    try {
      const res = await apiFetch(import.meta.env.VITE_API_URL + "/me/");
      if (!res.ok) throw new Error("Session expired");
      const user = await res.json();
      if (user.role !== "employee") {
        localStorage.clear();
        window.location.href = "/login";
        return;
      }
      if (String(user.id) !== String(employeeId)) throw new Error("Session user mismatch");
      if (user.username !== employeeName) {
        localStorage.setItem("username", user.username);
      }
    } catch (err) {
      console.error(err);
      handleLogout();
    }
  };

  const fetchWorks = async (options = {}) => {
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/employee-work/${employeeId}/`);
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      setWorks(data);
    } catch (err) {
      if (!options.silent) setError(err.message);
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  const updateStatus = async (workId, status) => {
    setWorks((prev) => prev.map((w) => (w.id === workId ? { ...w, status } : w)));
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/update-work/${workId}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed");
      notify(status === "completed" ? "Task completed!" : "Task accepted!");
    } catch (err) {
      fetchWorks();
      notify("Status update failed. Please try again.", "danger");
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/users/?exclude_id=${employeeId}`);
      if (!res.ok) throw new Error("Failed to load people");
      const data = await res.json();
      const availableContacts = data.filter(
        (user) => String(user.id) !== String(employeeId) && user.username !== employeeName
      );
      setContacts(availableContacts);
      setSelectedManager((current) => {
        if (availableContacts.some((user) => String(user.id) === String(current))) return current;
        return "";
      });
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMessages = async (managerId, options = {}) => {
    if (!employeeId || !managerId) return;
    const requestId = ++messageRequestRef.current;
    const requestedManagerId = String(managerId);
    if (!options.silent) setMessageLoading(true);
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${employeeId}/${managerId}/`);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      if (requestId !== messageRequestRef.current || String(selectedManagerRef.current) !== requestedManagerId) return;
      if (!Array.isArray(data)) throw new Error("Invalid messages response");
      setMessages(data);
      if (activeTab === "messages") {
        await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${employeeId}/${managerId}/seen/`, { method: "POST" });
        fetchUnreadCount();
        fetchContactSummaries();
      }
    } catch (err) {
      console.error(err);
      if (!options.silent) notify("Could not load messages", "danger");
    } finally {
      if (!options.silent && String(selectedManagerRef.current) === requestedManagerId) {
        setMessageLoading(false);
      }
    }
  };

  const fetchUnreadCount = async () => {
    if (!employeeId) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/unread/${employeeId}/`);
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchContactSummaries = async () => {
    if (!employeeId) return;
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/summaries/${employeeId}/`);
      if (res.ok) {
        const data = await res.json();
        setContactSummaries(Object.fromEntries(data.map((item) => [item.contact, item])));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    localStorage.setItem("logged_out", "true");
    window.location.href = "/login";
  };

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const dismissDeadline = (type) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const newList = [...dismissedAlerts, type];
    setDismissedAlerts(newList);
    localStorage.setItem(`dismissed_deadlines_${todayStr}`, JSON.stringify(newList));
  };

  const sendMessage = async () => {
    const receiverId = selectedManager;
    const body = messageBody.trim();
    if (!receiverId || String(receiverId) === String(employeeId) || !body || messageSending) return;
    setMessageSending(true);
    try {
      const res = await apiFetch(import.meta.env.VITE_API_URL + "/messages/send/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: employeeId, receiver: receiverId, body }),
      });
      if (!res.ok) throw new Error("Message failed to send");
      const sent = await res.json();
      if (String(selectedManagerRef.current) === String(receiverId)) {
        setMessages((prev) => [...prev, sent]);
      }
      setMessageBody("");
      fetchMessages(receiverId, { silent: true });
      fetchContactSummaries();
    } catch (err) {
      console.error(err);
      notify("Message failed to send. Please try again.", "danger");
    } finally {
      setMessageSending(false);
    }
  };

  const startEditMessage = (msg) => {
    setEditingMessageId(msg.id);
    setEditingMessageBody(msg.body);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingMessageBody("");
  };

  const saveEditedMessage = async (messageId) => {
    if (!editingMessageBody.trim()) {
      notify("Message cannot be empty", "warning");
      return;
    }
    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${messageId}/edit/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: employeeId, body: editingMessageBody }),
    });
    if (res.ok) {
      const updated = await res.json();
      setMessages((prev) => prev.map((msg) => (msg.id === messageId ? updated : msg)));
      cancelEditMessage();
      fetchContactSummaries();
      notify("Message updated");
    } else {
      notify("Message edit failed", "danger");
    }
  };

  const deleteMessage = async (messageId) => {
    if (!window.confirm("Delete this message?")) return;
    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${messageId}/delete/`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: employeeId }),
    });
    if (res.ok) {
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      fetchContactSummaries();
      notify("Message deleted", "danger");
    } else {
      notify("Message delete failed", "danger");
    }
  };

  const handleAction = (task, type) => {
    setTaskActionModal({ task, type });
  };

  const confirmAction = async () => {
    if (!taskActionModal) return;
    const { task, type } = taskActionModal;
    const status = type === "accept" ? "in_progress" : "completed";

    await updateStatus(task.id, status);
    setTaskActionModal(null);
  };


  const sortedWorks = [...works].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const filtered = filter === "all" ? sortedWorks : sortedWorks.filter((w) => w.status === filter);
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c.username]));

  const activeTabLabel = { overview: "Overview", tasks: "My Tasks", messages: "Messages" };
  const activeTabSub = {
    overview: "Your workload at a glance",
    tasks: "All your assigned tasks",
    messages: "Private encrypted messages",
  };

  return (
    <div style={s.container} className="dashboard-container employee-dashboard">
      {notification && (
        <div style={{ ...s.toast, ...s[`toast_${notification.type}`] }}>{notification.msg}</div>
      )}

      {/* Mobile Top Header */}
      <div className="mobile-header">
        <div className="mobile-header-logo-section">
          <button className="mobile-hamburger-btn" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <div style={{ ...s.logo, paddingLeft: 0 }}>
            <span style={s.logoIcon}>E</span>
            <span style={s.logoText}>Employee</span>
          </div>
        </div>
        <span className="mobile-header-title">{activeTabLabel[activeTab]}</span>
        <div className="mobile-header-avatar">{initials(employeeName)}</div>
      </div>

      {/* Sidebar Overlay backdrop */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <div style={s.notificationStack} className="dashboard-notification-stack">
        {unreadCount > 0 && activeTab !== "messages" && (
          <button style={s.messagePopup} onClick={() => setActiveTab("messages")}>
            <span style={s.notifIcon}>✉</span>
            {unreadCount} new message{unreadCount === 1 ? "" : "s"}
          </button>
        )}

        {deadlineInfo.overdue.length > 0 && !dismissedAlerts.includes("overdue") && (
          <div style={{ ...s.deadlinePopup, background: "#FCEBEB", color: "#A32D2D", border: "1px solid #fecaca" }} className="dashboard-deadlinePopup">
            <span style={s.notifIcon}>⚠️</span>
            <span style={{ flex: 1 }}><b>OVERDUE:</b> {deadlineInfo.overdue.length} task{deadlineInfo.overdue.length === 1 ? "" : "s"} past deadline!</span>
            <button onClick={() => dismissDeadline("overdue")} style={s.dismissBtn}>×</button>
          </div>
        )}

        {deadlineInfo.today.length > 0 && !dismissedAlerts.includes("today") && (
          <div style={{ ...s.deadlinePopup, background: "#FFFBEB", color: "#B45309", border: "1px solid #fef3c7", animation: "pulse 2s infinite" }} className="dashboard-deadlinePopup">
            <span style={s.notifIcon}>⚡</span>
            <span style={{ flex: 1 }}><b>Ends TODAY:</b> {deadlineInfo.today.length} task{deadlineInfo.today.length === 1 ? "" : "s"} must be finished today!</span>
            <button onClick={() => dismissDeadline("today")} style={s.dismissBtn}>×</button>
          </div>
        )}

        {deadlineInfo.day1.length > 0 && !dismissedAlerts.includes("day1") && (
          <div style={{ ...s.deadlinePopup, background: "#FFFBEB", color: "#B45309", border: "1px solid #fef3c7" }} className="dashboard-deadlinePopup">
            <span style={s.notifIcon}>⏰</span>
            <span style={{ flex: 1 }}><b>1 Day Left:</b> {deadlineInfo.day1.length} task{deadlineInfo.day1.length === 1 ? "" : "s"} ending tomorrow.</span>
            <button onClick={() => dismissDeadline("day1")} style={s.dismissBtn}>×</button>
          </div>
        )}

        {deadlineInfo.day2.length > 0 && !dismissedAlerts.includes("day2") && (
          <div style={{ ...s.deadlinePopup, background: "#F8FAFC", color: "#475569", border: "1px solid #e2e8f0" }} className="dashboard-deadlinePopup">
            <span style={s.notifIcon}>📅</span>
            <span style={{ flex: 1 }}><b>2 Days Left:</b> {deadlineInfo.day2.length} task{deadlineInfo.day2.length === 1 ? "" : "s"} ending soon.</span>
            <button onClick={() => dismissDeadline("day2")} style={s.dismissBtn}>×</button>
          </div>
        )}
      </div>

      <aside style={s.sidebar} className={`dashboard-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div style={s.sidebarTop}>
          <div className="sidebar-mobile-close">
            <button className="sidebar-mobile-close-btn" onClick={() => setSidebarOpen(false)}>×</button>
          </div>
          <div style={s.logo}>
            <span style={s.logoIcon}>E</span>
            <span style={s.logoText}>Employee</span>
          </div>
          <nav style={s.nav}>
            {[
              { id: "overview", label: "Overview", icon: "O" },
              { id: "tasks", label: "My Tasks", icon: "T", badge: uncompletedCount || null },
              { id: "messages", label: "Messages", icon: "M", badge: unreadCount || null },
            ].map((tab) => (
              <button
                key={tab.id}
                style={{ ...s.navItem, ...(activeTab === tab.id ? s.navItemActive : {}) }}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSidebarOpen(false);
                }}
              >
                <span style={s.navIcon}>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge > 0 && <span style={s.navBadge}>{tab.badge}</span>}
              </button>
            ))}
          </nav>
        </div>
        <button style={s.logoutBtn} onClick={() => { handleLogout(); setSidebarOpen(false); }}>
          <span style={{ fontSize: 14 }}>X</span>
          <span>Logout</span>
        </button>
      </aside>

      <main style={s.main} className="dashboard-main">
        <div style={s.pageHeader} className="pageHeader">
          <div>
            <h1 style={s.pageTitle}>{activeTabLabel[activeTab]}</h1>
            <p style={s.pageSubtitle}>{activeTabSub[activeTab]}</p>
          </div>
          <div style={s.headerRight}>
            <div style={s.avatarChip}>
              <div style={s.avatar}>{initials(employeeName)}</div>
              <span style={s.avatarName}>{employeeName}</span>
            </div>
          </div>
        </div>

        {activeTab === "overview" && (
          <>
            <div style={s.statsRow} className="dashboard-stats-row">
              <StatCard label="Pending" value={counts.pending} variant="pending" />
              <StatCard label="In Progress" value={counts.in_progress} variant="in_progress" />
              <StatCard label="Completed" value={counts.completed} variant="completed" />
            </div>
            <SectionCard title={`Recent Tasks (${sortedWorks.slice(0, 5).length})`}>
              {works.length === 0 && <p style={s.emptyText}>No tasks assigned yet</p>}
              {sortedWorks.slice(0, 5).map((work, i) => (
                <React.Fragment key={work.id}>
                  {i > 0 && <Divider />}
                  <div style={s.taskRow} className="dashboard-task-row">
                    <div style={{ ...s.statusBar, background: STATUS_META[work.status]?.bar }} />
                    <div style={s.taskLeft}>
                      <div style={s.taskTitle}>{work.title}</div>
                      <div style={s.taskDesc}>{work.description}</div>
                      <div style={s.taskMeta}>
                        <Badge status={work.status} />
                        {work.completion_date && (
                          <span style={s.taskEmployee}>Due: {new Date(work.completion_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </SectionCard>
          </>
        )}

        {activeTab === "tasks" && (
          <SectionCard
            title={`My Tasks (${filtered.length})`}
            action={
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["all", "pending", "in_progress", "completed"].map((f) => (
                  <button
                    key={f}
                    style={{ ...s.pill, ...(filter === f ? s.pillActive : {}) }}
                    onClick={() => setFilter(f)}
                  >
                    {f === "all" ? "All" : f === "in_progress" ? "Active" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            }
          >
            {loading && <p style={s.emptyText}>Loading tasks…</p>}
            {error && <p style={{ ...s.emptyText, color: "#A32D2D" }}>{error}</p>}
            {!loading && !error && filtered.length === 0 && <p style={s.emptyText}>No tasks here</p>}
            {!loading && !error && filtered.map((work, i) => (
              <React.Fragment key={work.id}>
                {i > 0 && <Divider />}
                <div style={s.taskRow} className="dashboard-task-row">
                  <div style={{ ...s.statusBar, background: STATUS_META[work.status]?.bar }} />
                  <div style={s.taskLeft}>
                    <div style={s.taskTitle}>{work.title}</div>
                    <div style={s.taskDesc}>{work.description}</div>
                    <div style={{ ...s.taskMeta, flexWrap: "wrap", gap: 10 }}>
                      <span style={s.taskEmployee}>By: {contactMap[work.manager] || "Manager"}</span>
                      <span style={s.taskEmployee}>Assigned: {new Date(work.created_at).toLocaleDateString()}</span>
                      {work.completion_date && (
                        <span style={s.taskEmployee}>Due: {new Date(work.completion_date).toLocaleDateString()}</span>
                      )}
                      <Badge status={work.status} />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }} className="dashboard-task-actions">
                    {work.status === "pending" && (
                      <button style={{ ...s.actionBtn, background: "#185FA5", color: "#E6F1FB" }}
                        onClick={() => handleAction(work, "accept")}>Accept</button>
                    )}
                    {work.status === "in_progress" && (
                      <button style={{ ...s.actionBtn, background: "#3B6D11", color: "#EAF3DE" }}
                        onClick={() => handleAction(work, "complete")}>Mark done</button>
                    )}
                  </div>
                </div>
              </React.Fragment>
            ))}
          </SectionCard>
        )}

        {activeTab === "messages" && (
          <div style={s.messageGrid} className="dashboard-message-grid">
            <SectionCard title={`People (${contacts.length})`} className={`chat-contacts-panel ${selectedManager ? "has-selected" : ""}`}>
              {contacts.length === 0 && <p style={s.emptyText}>No contacts found</p>}
              {contacts.map((person, i) => {
                const ac = AVATAR_COLORS[i % AVATAR_COLORS.length];
                const summary = contactSummaries[person.id] || {};
                return (
                  <button key={person.id} style={{ ...s.contactRow, ...(String(selectedManager) === String(person.id) ? s.contactRowActive : {}) }}
                    onClick={() => setSelectedManager(person.id)}>
                    <span style={{ ...s.contactAvatar, background: ac.bg, color: ac.color }}>{initials(person.username)}</span>
                    <span style={s.contactInfo}>
                      <span style={s.contactNameRow}>
                        <span style={s.empName}>{person.username}</span>
                        {summary.unread_count > 0 && <span style={s.navBadge}>{summary.unread_count}</span>}
                      </span>
                      <span style={{ fontSize: 11, color: summary.unread_count > 0 ? "#185FA5" : "#64748b" }}>
                        {summary.unread_count > 0 ? `${summary.unread_count} unread` : summary.status || "No messages"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </SectionCard>

            <SectionCard title={selectedManager ? `Chat with ${contactMap[selectedManager] || "..."}` : "Messages"}
              className={`chat-window-panel ${selectedManager ? "has-selected" : ""}`}
              action={<span style={s.secureChip}>Encrypted</span>}>
              {!selectedManager && <p style={s.emptyText}>Select a person to start messaging</p>}
              {selectedManager && (
                <>
                  <button className="back-to-people-btn" onClick={() => setSelectedManager("")}>
                    ← Back to People
                  </button>
                  <div style={s.messageList} className="dashboard-messageList" ref={scrollContainerRef}>
                    {messageLoading && <p style={s.emptyText}>Loading…</p>}
                    {!messageLoading && messages.length === 0 && <p style={s.emptyText}>No messages yet</p>}
                    {!messageLoading && messages.map((msg) => {
                      const isMine = String(msg.sender) === String(employeeId);
                      return (
                        <div key={msg.id} style={{ ...s.messageBubbleWrap, justifyContent: isMine ? "flex-end" : "flex-start" }} className="dashboard-messageBubbleWrap">
                          <div style={{ ...s.messageBubble, ...(isMine ? s.messageMine : s.messageTheirs) }} className="dashboard-messageBubble">
                            {editingMessageId === msg.id ? (
                              <>
                                <textarea style={s.editMessageInput} value={editingMessageBody}
                                  onChange={(e) => setEditingMessageBody(e.target.value)} />
                                <div style={s.messageActions}>
                                  <button style={s.messageTinyBtn} onClick={() => saveEditedMessage(msg.id)}>Save</button>
                                  <button style={s.messageTinyBtn} onClick={cancelEditMessage}>Cancel</button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div style={s.messageText}>{msg.body}</div>
                                <div style={s.messageMeta}>
                                  {formatMessageTime(msg.created_at)}
                                  {msg.edited_at && " · Edited"}
                                  {isMine && ` · ${msg.seen_at ? "Seen" : "Delivered"}`}
                                </div>
                                {isMine && (
                                  <div style={s.messageActions}>
                                    <button style={s.messageTinyBtn} onClick={() => startEditMessage(msg)}>Edit</button>
                                    <button style={s.messageTinyBtn} onClick={() => deleteMessage(msg.id)}>Delete</button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                  <div style={s.messageComposer} className="dashboard-messageComposer">
                    <textarea style={s.messageInput} className="dashboard-messageInput" placeholder="Write a message..."
                      value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
                    <button style={{ ...s.btnSend, ...(messageSending ? { opacity: 0.65 } : {}) }}
                      onClick={sendMessage} disabled={messageSending}>
                      {messageSending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </>
              )}
            </SectionCard>
          </div>
        )}
      </main>

      {/* Modals */}
      {taskActionModal && (
        <ActionModal
          type={taskActionModal.type}
          task={taskActionModal.task}
          onClose={() => setTaskActionModal(null)}
          onConfirm={confirmAction}
        />
      )}
    </div>
  );
};

export default EmployeeDashboard;

/* ═══ STYLES ═══ */

const STATUS_META = {
  pending: { label: "Pending", bg: "#FAEEDA", color: "#854F0B", dot: "#EF9F27", bar: "#EF9F27" },
  in_progress: { label: "In progress", bg: "#E6F1FB", color: "#185FA5", dot: "#378ADD", bar: "#378ADD" },
  completed: { label: "Completed", bg: "#EAF3DE", color: "#3B6D11", dot: "#639922", bar: "#639922" },
};

const AVATAR_COLORS = [
  { bg: "#E6F1FB", color: "#185FA5" },
  { bg: "#EAF3DE", color: "#3B6D11" },
  { bg: "#FAEEDA", color: "#854F0B" },
  { bg: "#EEEDFE", color: "#534AB7" },
  { bg: "#E1F5EE", color: "#0F6E56" },
];

const SectionCard = ({ title, action, children, className }) => (
  <div style={s.card} className={`dashboard-card ${className || ""}`}>
    <div style={s.cardHeader} className="dashboard-cardHeader">
      <span style={s.cardTitle}>{title}</span>
      {action}
    </div>
    {children}
  </div>
);

const Divider = () => <div style={s.divider} />;

const StatCard = ({ label, value, variant }) => {
  const colors = { pending: "#EF9F27", in_progress: "#378ADD", completed: "#639922" };
  return (
    <div style={s.statCard} className="statCard">
      <div style={{ ...s.statAccentBar, background: colors[variant] || "#378ADD" }} />
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValue}>{value}</div>
      <div style={s.statSub}>
        {variant === "pending" ? "awaiting action" : variant === "in_progress" ? "currently active" : "finished tasks"}
      </div>
    </div>
  );
};

const Badge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{ ...s.badge, background: m.bg, color: m.color }}>
      <span style={{ ...s.badgeDot, background: m.dot }} />
      {m.label}
    </span>
  );
};

const ActionModal = ({ type, task, onClose, onConfirm }) => (
  <div style={s.modalOverlay} onClick={onClose} className="dashboard-modalOverlay">
    <div style={s.modalContent} onClick={(e) => e.stopPropagation()} className="dashboard-modalContent">
      <h3 style={s.modalTitle}>{type === "accept" ? "Accept Task" : "Complete Task"}</h3>
      <p style={s.modalDesc}>
        {type === "accept"
          ? `Are you sure you want to start working on "${task.title}"?`
          : `Are you sure you want to mark "${task.title}" as completed?`}
      </p>

      <div style={s.modalFooter} className="dashboard-modalFooter">
        <button style={{ ...s.pill, border: "none", background: "#f1f5f9" }} onClick={onClose}>
          Cancel
        </button>
        <button
          style={{
            ...s.actionBtn,
            background: type === "accept" ? "#185FA5" : "#3B6D11",
            color: "#fff",
            padding: "8px 20px",
          }}
          onClick={onConfirm}
        >
          {type === "accept" ? "Confirm Accept" : "Confirm Completion"}
        </button>
      </div>
    </div>
  </div>
);

const s = {
  container: {
    display: "flex",
    minHeight: "100vh",
    background: "#f4f7fb",
    fontFamily: "'Plus Jakarta Sans', Arial, sans-serif",
  },
  toast: { position: "fixed", top: 20, right: 20, zIndex: 9999, padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" },
  toast_success: { background: "#EAF3DE", color: "#3B6D11" },
  toast_danger: { background: "#FCEBEB", color: "#A32D2D" },
  toast_warning: { background: "#FAEEDA", color: "#854F0B" },

  notificationStack: {
    position: "fixed",
    top: 18,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 9998,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    alignItems: "center",
    pointerEvents: "none",
  },
  messagePopup: {
    pointerEvents: "auto",
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    background: "#185FA5",
    color: "#E6F1FB",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.14)",
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  notifIcon: { fontSize: 16 },

  deadlinePopup: {
    pointerEvents: "auto",
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    maxWidth: 400,
  },
  dismissBtn: {
    pointerEvents: "auto",
    background: "transparent",
    border: "none",
    fontSize: 18,
    lineHeight: 1,
    cursor: "pointer",
    color: "inherit",
    opacity: 0.5,
    padding: "4px 8px",
    marginLeft: "auto",
  },

  sidebar: { width: 220, minWidth: 220, background: "#fff", borderRight: "0.5px solid #e2e8f0", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "24px 12px", position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" },
  sidebarTop: { display: "flex", flexDirection: "column", gap: 28 },
  logo: { display: "flex", alignItems: "center", gap: 10, paddingLeft: 8 },
  logoIcon: { width: 32, height: 32, borderRadius: 8, background: "#185FA5", color: "#E6F1FB", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', Arial, sans-serif", fontSize: 16, fontWeight: 700 },
  logoText: { fontFamily: "'Syne', Arial, sans-serif", fontSize: 15, fontWeight: 700, color: "#0f172a" },
  nav: { display: "flex", flexDirection: "column", gap: 4 },
  navItem: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 500, color: "#64748b", width: "100%", textAlign: "left" },
  navItemActive: { background: "#f1f5f9", color: "#0f172a", fontWeight: 600 },
  navIcon: { width: 22, height: 22, borderRadius: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  navBadge: { marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 20, background: "#185FA5", color: "#E6F1FB", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, padding: "0 5px" },
  logoutBtn: { display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, border: "0.5px solid #fecaca", background: "#fff", color: "#A32D2D", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, width: "100%" },

  main: { flex: 1, padding: "28px 32px", overflowY: "auto", maxWidth: "100%" },
  pageHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, gap: 12 },
  pageTitle: { fontFamily: "'Syne', Arial, sans-serif", fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 },
  pageSubtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  avatarChip: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 10, padding: "6px 14px 6px 8px" },
  avatar: { width: 30, height: 30, borderRadius: "50%", background: "#185FA5", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', Arial, sans-serif", fontSize: 12, fontWeight: 700, color: "#B5D4F4", flexShrink: 0 },
  avatarName: { fontSize: 13, fontWeight: 600, color: "#0f172a" },

  statsRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 },
  statCard: { background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 12, padding: 20, position: "relative", overflow: "hidden" },
  statAccentBar: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  statLabel: { fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 6, marginTop: 8 },
  statValue: { fontFamily: "'Syne', Arial, sans-serif", fontSize: 30, fontWeight: 700, color: "#0f172a", lineHeight: 1 },
  statSub: { fontSize: 11, color: "#94a3b8", marginTop: 4 },

  card: { background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 12, padding: "20px", marginBottom: 20 },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 8, flexWrap: "wrap" },
  cardTitle: { fontFamily: "'Syne', Arial, sans-serif", fontSize: 15, fontWeight: 700, color: "#0f172a" },
  divider: { height: "0.5px", background: "#e2e8f0", margin: "10px 0" },

  taskRow: { display: "flex", alignItems: "flex-start", gap: 12, padding: "6px 0", position: "relative" },
  statusBar: { width: 3, borderRadius: "2px", alignSelf: "stretch", flexShrink: 0, minHeight: 40 },
  taskLeft: { flex: 1, minWidth: 0 },
  taskTitle: { fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 3 },
  taskDesc: { fontSize: 12, color: "#64748b", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  taskMeta: { display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  taskEmployee: { fontSize: 11, color: "#64748b", background: "#f1f5f9", borderRadius: 6, padding: "2px 7px" },
  emptyText: { textAlign: "center", color: "#94a3b8", padding: "24px 0", fontSize: 13 },

  badge: { fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 4 },
  badgeDot: { width: 5, height: 5, borderRadius: "50%" },

  pill: { fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, border: "0.5px solid #cbd5e1", cursor: "pointer", color: "#64748b", background: "transparent", fontFamily: "inherit" },
  pillActive: { background: "#f1f5f9", color: "#0f172a", borderColor: "#94a3b8" },

  actionBtn: { fontSize: 11, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit" },

  messageGrid: { display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 20, alignItems: "start" },
  contactRow: { width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px", border: "0.5px solid transparent", borderRadius: 8, background: "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left", outline: "none" },
  contactRowActive: { background: "#f1f5f9", borderColor: "#cbd5e1" },
  contactAvatar: { width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', Arial, sans-serif", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  contactInfo: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  contactNameRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  empName: { fontSize: 13, fontWeight: 600, color: "#0f172a" },
  secureChip: { fontSize: 10, fontWeight: 700, color: "#0F6E56", background: "#E1F5EE", borderRadius: 20, padding: "4px 9px" },
  messageList: { minHeight: 280, maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "12px", border: "0.5px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" },
  messageBubbleWrap: { display: "flex" },
  messageBubble: { maxWidth: "72%", borderRadius: 8, padding: "9px 11px", fontSize: 13, lineHeight: 1.45 },
  messageMine: { background: "#185FA5", color: "#E6F1FB" },
  messageTheirs: { background: "#fff", color: "#0f172a", border: "0.5px solid #e2e8f0" },
  messageText: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  messageMeta: { fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: "right" },
  messageActions: { display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 },
  messageTinyBtn: { border: "0.5px solid rgba(100,116,139,0.35)", borderRadius: 6, background: "rgba(255,255,255,0.18)", color: "inherit", cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 700, padding: "3px 7px" },
  editMessageInput: { width: "100%", minHeight: 56, resize: "vertical", border: "0.5px solid rgba(100,116,139,0.35)", borderRadius: 6, padding: 8, boxSizing: "border-box", fontFamily: "inherit", fontSize: 13 },
  messageComposer: { display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 12, alignItems: "end" },
  messageInput: { width: "100%", minHeight: 58, resize: "vertical", padding: "9px 12px", fontSize: 13, color: "#0f172a", background: "#f8fafc", border: "0.5px solid #cbd5e1", borderRadius: 8, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  btnSend: { fontSize: 12, fontWeight: 700, padding: "11px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "#185FA5", color: "#E6F1FB", fontFamily: "inherit" },

  /* Modal Styles */
  modalOverlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 20 },
  modalContent: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 440, padding: "28px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)", animation: "fadeIn 0.2s ease-out" },
  modalTitle: { fontFamily: "'Syne', Arial, sans-serif", fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 10px 0" },
  modalDesc: { fontSize: 14, color: "#64748b", lineHeight: 1.6, margin: "0 0 10px 0" },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 },
};
