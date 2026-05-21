import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";



/* Google Fonts */
const injectFonts = () => {
  if (document.getElementById("md-fonts")) return;
  const link = document.createElement("link");
  link.id = "md-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Syne:wght@700&display=swap";
  document.head.appendChild(link);
};

/* Helpers */
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

/* Sub-components */

const Badge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{ ...s.badge, background: m.bg, color: m.color }}>
      <span style={{ ...s.badgeDot, background: m.dot }} />
      {m.label}
    </span>
  );
};

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

/* Main Component */

const ManagerDashboard = () => {
  injectFonts();

  const managerId = localStorage.getItem("user_id");
  const token = localStorage.getItem("token");
  const apiFetch = (url, options = {}) =>
    window.fetch(url, {
      ...options,
      headers: {
        Authorization: `Token ${token}`,
        ...(options.headers || {}),
      },
    });
  const getCurrentManagerId = () => managerProfile?.id || localStorage.getItem("user_id");
  const getCurrentManagerName = () => managerProfile?.username || localStorage.getItem("username") || "";

  const [employees, setEmployees] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [works, setWorks] = useState([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

  const [editingWorkId, setEditingWorkId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCompletionDate, setEditCompletionDate] = useState("");

  const [activeTab, setActiveTab] = useState("overview");
  const [notification, setNotification] = useState(null);
  const [selectedContact, setSelectedContact] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [taskEmployeeFilter, setTaskEmployeeFilter] = useState("all");
  const [reportEmployeeFilter, setReportEmployeeFilter] = useState("all");

  const [messages, setMessages] = useState([]);
  const [messageBody, setMessageBody] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [contactSummaries, setContactSummaries] = useState({});
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageBody, setEditingMessageBody] = useState("");
  const [managerProfile, setManagerProfile] = useState({
    id: managerId,
    username: localStorage.getItem("username") || "",
  });
  const messagesEndRef = useRef(null);
  const lastMsgCountRef = useRef(0);
  const lastSelectionRef = useRef("");
  const needsScrollRef = useRef(false);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const loadDashboard = async () => {
      const verifiedManager = await verifySession();
      fetchEmployees();
      fetchContacts(verifiedManager);
      fetchWorks();
      fetchUnreadCount(verifiedManager?.id);
      fetchContactSummaries(verifiedManager?.id);
    };

    loadDashboard();

    const dataTimer = setInterval(() => {
      fetchUnreadCount();
      fetchContactSummaries();
      fetchWorks({ silent: true });
      fetchEmployees({ silent: true });
    }, 5000);
    return () => clearInterval(dataTimer);
  }, []);

  useEffect(() => {
    if (activeTab === "messages" && selectedContact) {
      needsScrollRef.current = true;
      fetchMessages(selectedContact);
    }
  }, [activeTab, selectedContact]);

  useEffect(() => {
    if (activeTab !== "messages" || !selectedContact) return;

    const messageTimer = setInterval(() => {
      fetchMessages(selectedContact, { silent: true });
    }, 3000);

    return () => clearInterval(messageTimer);
  }, [activeTab, selectedContact]);

  useEffect(() => {
    if (!selectedContact || activeTab !== "messages") return;

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
  }, [messages, selectedContact, messageLoading, activeTab]);

  useEffect(() => {
    if (selectedContact && String(selectedContact) === String(getCurrentManagerId())) {
      setSelectedContact("");
      setMessages([]);
    }
  }, [selectedContact, managerProfile]);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const downloadCompletedPDF = () => {
    try {
      // Use completed_at if available, otherwise fall back to created_at for legacy tasks
      const filteredWorks = works
        .filter((w) => {
          if (w.status !== "completed") return false;
          if (reportEmployeeFilter !== "all" && String(w.employee) !== String(reportEmployeeFilter)) return false;
          const dateStr = w.completed_at || w.created_at;
          return dateStr && dateStr.startsWith(reportMonth);
        })
        .sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at));

      if (filteredWorks.length === 0) {
        notify(`No completed tasks found for ${reportMonth}`, "warning");
        return;
      }

      const doc = new jsPDF();
      const empMap = Object.fromEntries(employees.map((e) => [e.id, e.username]));
      
      // Parse month name carefully
      let monthName = reportMonth;
      try {
        monthName = new Date(reportMonth + "-01").toLocaleString("default", { month: "long", year: "numeric" });
      } catch (e) {
        console.error("Date parsing error", e);
      }

      // Title
      doc.setFontSize(18);
      doc.text(`Completed Tasks Report - ${monthName}`, 14, 20);
      
      // Subtitle
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 28);
      doc.text(`Employee Filter: ${reportEmployeeFilter === "all" ? "All" : empMap[reportEmployeeFilter]}`, 14, 34);

      const headers = [["Title", "Assigned To", "Start Date", "Due Date", "Completion Date"]];
      const data = filteredWorks.map((w) => [
        w.title,
        empMap[w.employee] || "Unassigned",
        w.created_at ? new Date(w.created_at).toLocaleDateString() : "",
        w.completion_date ? new Date(w.completion_date).toLocaleDateString() : "—",
        w.completed_at ? new Date(w.completed_at).toLocaleDateString() : "—",
      ]);

      autoTable(doc, {
        startY: 40,
        head: headers,
        body: data,
        theme: "grid",
        headStyles: { fillColor: [24, 95, 165], textColor: 255 },
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 50 }, // Title
        },
      });

      doc.save(`completed_works_${reportMonth}.pdf`);
      notify("PDF Report downloaded");
    } catch (err) {
      console.error("PDF Generation Error:", err);
      notify("Failed to generate PDF. Check console for details.", "danger");
    }
  };





  const verifySession = async () => {
    try {
      const res = await apiFetch(import.meta.env.VITE_API_URL + "/me/");
      if (!res.ok) throw new Error("Session expired");
      const user = await res.json();

      if (user.role !== "manager") {
        localStorage.clear();
        window.location.href = "/login";
        return null;
      }

      if (user.username !== localStorage.getItem("username")) {
        localStorage.setItem("username", user.username);
      }

      if (String(user.id) !== String(managerId)) {
        localStorage.setItem("user_id", user.id);
      }

      localStorage.setItem("role", user.role);
      setManagerProfile({ id: user.id, username: user.username });
      return user;
    } catch (e) {
      console.error(e);
      return null;
    }
  };

  /* API: Employees */
  const fetchEmployees = async (options = {}) => {
    try {
      const res = await apiFetch(import.meta.env.VITE_API_URL + "/employees/");
      const data = await res.json();
      setEmployees(data);
    } catch (e) { console.error(e); }
  };

  const fetchContacts = async (verifiedManager = managerProfile) => {
    try {
      const currentManagerId = verifiedManager?.id || managerId;
      const currentUsername = verifiedManager?.username || localStorage.getItem("username");
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/users/?exclude_id=${currentManagerId}`);
      const data = await res.json();
      const availableContacts = data.filter(
        (user) =>
          String(user.id) !== String(currentManagerId) &&
          user.username !== currentUsername
      );
      setContacts(availableContacts);
      setSelectedContact((current) =>
        availableContacts.some((user) => String(user.id) === String(current)) ? current : ""
      );
    } catch (e) { console.error(e); }
  };

  const approveEmployee = async (id) => {
    await apiFetch(`${import.meta.env.VITE_API_URL}/approve/${id}/`, { method: "PUT" });
    fetchEmployees();
    notify("Employee approved");
  };

  const deleteEmployee = async (id) => {
    if (!window.confirm("Remove this employee?")) return;
    await apiFetch(`${import.meta.env.VITE_API_URL}/delete/${id}/`, { method: "DELETE" });
    fetchEmployees();
    notify("Employee removed", "danger");
  };

  /* API: Works */
  const fetchWorks = async (options = {}) => {
    try {
      const res = await apiFetch(import.meta.env.VITE_API_URL + "/all-work/");
      const data = await res.json();
      setWorks(data);
    } catch (e) { console.error(e); }
  };

  const assignWork = async () => {
    if (!title.trim()) {
      notify("Please enter a task title", "warning");
      return;
    }
    if (!description.trim()) {
      notify("Please enter a description", "warning");
      return;
    }
    if (!selectedEmployee) {
      notify("Please select an employee to assign to", "warning");
      return;
    }
    setAssignLoading(true);
    const res = await apiFetch(import.meta.env.VITE_API_URL + "/assign-work/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        completion_date: completionDate || null,
        manager: managerId,
        employee: selectedEmployee,
      }),
    });
    setAssignLoading(false);
    if (res && res.ok) {
      setTitle("");
      setDescription("");
      setCompletionDate("");
      setSelectedEmployee("");
      fetchWorks();
      notify("Task assigned successfully");
      setActiveTab("tasks");
    } else {
      notify("Failed to assign task. Please try again.", "danger");
    }
  };

  const deleteWork = async (id) => {
    if (!window.confirm("Delete this task?")) return;
    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/delete-work/${id}/`, { method: "DELETE" });
    if (res.ok) {
      setWorks((prev) => prev.filter((w) => w.id !== id));
      notify("Task deleted", "danger");
    } else {
      notify("Delete failed", "danger");
    }
  };

  const startEdit = (work) => {
    setEditingWorkId(work.id);
    setEditTitle(work.title);
    setEditDescription(work.description);
    setEditCompletionDate(work.completion_date || "");
  };

  const updateWork = async () => {
    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/update-work/${editingWorkId}/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, description: editDescription, completion_date: editCompletionDate || null }),
    });
    if (res.ok) {
      setWorks((prev) =>
        prev.map((w) =>
          w.id === editingWorkId
            ? { ...w, title: editTitle, description: editDescription, completion_date: editCompletionDate || null }
            : w
        )
      );
      setEditingWorkId(null);
      notify("Task updated");
    } else {
      notify("Update failed", "danger");
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    localStorage.setItem("logged_out", "true");
    window.location.href = "/login";
  };

  const fetchMessages = async (contactId = selectedContact, options = {}) => {
    const currentManagerId = getCurrentManagerId();
    if (!currentManagerId || !contactId || String(contactId) === String(currentManagerId)) return;

    if (!options.silent) setMessageLoading(true);
    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${currentManagerId}/${contactId}/`);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      setMessages(data);
      if (activeTab === "messages") {
        await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${currentManagerId}/${contactId}/seen/`, {
          method: "POST",
        });
        fetchUnreadCount(currentManagerId);
        fetchContactSummaries(currentManagerId);
      }
    } catch (e) {
      console.error(e);
      if (!options.silent) notify("Could not load messages", "danger");
    } finally {
      if (!options.silent) setMessageLoading(false);
    }
  };

  const fetchUnreadCount = async (userId = getCurrentManagerId()) => {
    if (!userId) return;

    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/unread/${userId}/`);
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.count || 0);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchContactSummaries = async (userId = getCurrentManagerId()) => {
    if (!userId) return;

    try {
      const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/summaries/${userId}/`);
      if (!res.ok) return;
      const data = await res.json();
      setContactSummaries(Object.fromEntries(data.map((item) => [item.contact, item])));
    } catch (e) {
      console.error(e);
    }
  };

  const sendMessage = async () => {
    const currentManagerId = getCurrentManagerId();

    if (!selectedContact || String(selectedContact) === String(currentManagerId) || !messageBody.trim()) {
      notify("Select a person and write a message", "warning");
      return;
    }

    const res = await apiFetch(import.meta.env.VITE_API_URL + "/messages/send/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: currentManagerId,
        receiver: selectedContact,
        body: messageBody,
      }),
    });

    if (res.ok) {
      const sent = await res.json();
      setMessages((prev) => [...prev, sent]);
      setMessageBody("");
      fetchContactSummaries(currentManagerId);
    } else {
      notify("Message failed to send", "danger");
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
    const currentManagerId = getCurrentManagerId();

    if (!editingMessageBody.trim()) {
      notify("Message cannot be empty", "warning");
      return;
    }

    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${messageId}/edit/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: currentManagerId, body: editingMessageBody }),
    });

    if (res.ok) {
      const updated = await res.json();
      setMessages((prev) => prev.map((msg) => (msg.id === messageId ? updated : msg)));
      cancelEditMessage();
      fetchContactSummaries(currentManagerId);
      notify("Message updated");
    } else {
      notify("Message edit failed", "danger");
    }
  };

  const deleteMessage = async (messageId) => {
    const currentManagerId = getCurrentManagerId();

    if (!window.confirm("Delete this message?")) return;

    const res = await apiFetch(`${import.meta.env.VITE_API_URL}/messages/${messageId}/delete/`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: currentManagerId }),
    });

    if (res.ok) {
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      fetchContactSummaries(currentManagerId);
      notify("Message deleted", "danger");
    } else {
      notify("Message delete failed", "danger");
    }
  };

  /* Derived */
  const currentManagerId = getCurrentManagerId();
  const currentManagerName = getCurrentManagerName();
  const messagingContacts = contacts.filter(
    (user) =>
      String(user.id) !== String(currentManagerId) &&
      user.username !== currentManagerName
  );
  const employeeMap = Object.fromEntries(employees.map((e) => [e.id, e.username]));
  const contactMap = {
    ...Object.fromEntries(employees.map((user) => [user.id, user.username])),
    ...Object.fromEntries(messagingContacts.map((user) => [user.id, user.username])),
  };
  const selectedUnreadCount = contactSummaries[selectedContact]?.unread_count || 0;
  const pending = employees.filter((e) => !e.is_approved).length;
  const taskCounts = {
    pending: works.filter((w) => w.status === "pending").length,
    in_progress: works.filter((w) => w.status === "in_progress").length,
    completed: works.filter((w) => w.status === "completed").length,
  };

  /* Render */
  return (
    <div style={s.container} className="dashboard-container manager-dashboard">
      {/* Notification toast */}
      {notification && (
        <div style={{ ...s.toast, ...s[`toast_${notification.type}`] }}>
          {notification.msg}
        </div>
      )}

      {/* Mobile Top Header */}
      <div className="mobile-header">
        <div className="mobile-header-logo-section">
          <button className="mobile-hamburger-btn" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <div style={{ ...s.logo, paddingLeft: 0 }}>
            <span style={s.logoIcon}>M</span>
            <span style={s.logoText}>Manager</span>
          </div>
        </div>
        <span className="mobile-header-title">
          {activeTab === "overview" && "Overview"}
          {activeTab === "employees" && "Team Members"}
          {activeTab === "tasks" && "Task Board"}
          {activeTab === "assign" && "Assign Task"}
          {activeTab === "completed" && "Completed Reports"}
          {activeTab === "messages" && "Private Messages"}
        </span>
        <div className="mobile-header-avatar">{initials(getCurrentManagerName())}</div>
      </div>

      {/* Sidebar Overlay backdrop */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {unreadCount > 0 && activeTab !== "messages" && (
        <button style={s.messagePopup} onClick={() => setActiveTab("messages")}>
          {unreadCount} new message{unreadCount === 1 ? "" : "s"}
        </button>
      )}

      {/* Sidebar */}
      <aside style={s.sidebar} className={`dashboard-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div style={s.sidebarTop}>
          <div className="sidebar-mobile-close">
            <button className="sidebar-mobile-close-btn" onClick={() => setSidebarOpen(false)}>×</button>
          </div>
          <div style={s.logo}>
            <span style={s.logoIcon}>M</span>
            <span style={s.logoText}>Manager</span>
          </div>

          <nav style={s.nav}>
            {[
              { id: "overview", label: "Overview", icon: "O" },
              { id: "employees", label: "Employees", icon: "E", badge: pending || null },
              { id: "tasks", label: "All Tasks", icon: "T" },
              { id: "assign", label: "Assign Task", icon: "+" },
              { id: "completed", label: "Completed Reports", icon: "C" },
              { id: "messages", label: "Messages", icon: "M", badge: unreadCount || null },
            ].map((tab) => (
              <button
                key={tab.id}
                style={{
                  ...s.navItem,
                  ...(activeTab === tab.id ? s.navItemActive : {}),
                }}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSidebarOpen(false);
                }}
              >
                <span style={s.navIcon}>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge > 0 && (
                  <span style={s.navBadge}>{tab.badge}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <button style={s.logoutBtn} onClick={() => { handleLogout(); setSidebarOpen(false); }}>
          <span style={{ fontSize: 14 }}>X</span>
          <span>Logout</span>
        </button>
      </aside>

      {/* Main content */}
      <main style={s.main} className="dashboard-main">
        {/* Page header */}
        <div style={s.pageHeader} className="pageHeader">
          <div>
            <h1 style={s.pageTitle}>
              {activeTab === "overview" && "Overview"}
              {activeTab === "employees" && "Team Members"}
              {activeTab === "tasks" && "Task Board"}
              {activeTab === "assign" && "Assign Task"}
              {activeTab === "completed" && "Completed Reports"}
              {activeTab === "messages" && "Private Messages"}
            </h1>
            <p style={s.pageSubtitle}>
              {activeTab === "overview" && "Your team's performance at a glance"}
              {activeTab === "employees" && "Manage and approve your team"}
              {activeTab === "tasks" && "Track all assigned work"}
              {activeTab === "assign" && "Create and delegate a new task"}
              {activeTab === "completed" && "View and download completed task history"}
              {activeTab === "messages" && "Personal encrypted messages with everyone"}
            </p>
          </div>
        </div>

        {/* Overview tab */}
        {activeTab === "overview" && (
          <div>
            <div style={s.statsGrid} className="dashboard-stats-grid">
              {[
                { label: "Total Employees", value: employees.length, accent: "#185FA5", sub: "team members" },
                { label: "Pending Approval", value: pending, accent: "#EF9F27", sub: "awaiting review" },
                { label: "Tasks In Progress", value: taskCounts.in_progress, accent: "#378ADD", sub: "active now" },
                { label: "Completed", value: taskCounts.completed, accent: "#639922", sub: "finished tasks" },
              ].map((stat) => (
                <div key={stat.label} style={s.statCard} className="statCard">
                  <div style={{ ...s.statAccent, background: stat.accent }} />
                  <div style={s.statLabel}>{stat.label}</div>
                  <div style={s.statValue}>{stat.value}</div>
                  <div style={s.statSub}>{stat.sub}</div>
                </div>
              ))}
            </div>

            {/* Recent tasks preview */}
            <SectionCard title="Recent Tasks">
              {[...works]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 4)
                .map((work, i) => (
                  <React.Fragment key={work.id}>
                    {i > 0 && <Divider />}
                    <div style={s.overviewRow} className="dashboard-task-row">
                      <div style={{ ...s.statusBar, background: STATUS_META[work.status]?.bar }} />
                      <div style={s.overviewLeft}>
                        <span style={s.overviewTitle}>{work.title}</span>
                        <span style={s.overviewEmployee}>
                          {employeeMap[work.employee] || "-"}
                        </span>
                      </div>
                      <Badge status={work.status} />
                    </div>
                  </React.Fragment>
                ))}
              {works.length === 0 && <p style={s.emptyText}>No tasks yet</p>}
            </SectionCard>
          </div>
        )}

        {/* Employees tab */}
        {activeTab === "employees" && (
          <SectionCard title={`Team Members (${employees.length})`}>
            {employees.length === 0 && <p style={s.emptyText}>No employees found</p>}
            {employees.map((emp, i) => {
              const ac = AVATAR_COLORS[i % AVATAR_COLORS.length];
              return (
                <React.Fragment key={emp.id}>
                  {i > 0 && <Divider />}
                  <div style={s.empRow} className="dashboard-emp-row">
                    <div style={{ ...s.empAvatar, background: ac.bg, color: ac.color }}>
                      {initials(emp.username)}
                    </div>
                    <div style={s.empInfo}>
                      <span style={s.empName}>{emp.username}</span>
                      <span style={s.empEmail}>{emp.email}</span>
                    </div>
                    <div style={s.empStatus} className="dashboard-emp-status">
                      {emp.is_approved ? (
                        <span style={s.approvedChip}>Approved</span>
                      ) : (
                        <span style={s.pendingChip}>Pending</span>
                      )}
                    </div>
                    <div style={s.empActions} className="dashboard-emp-actions">
                      {!emp.is_approved && (
                        <button
                          style={s.btnApprove}
                          onClick={() => approveEmployee(emp.id)}
                        >
                          Approve
                        </button>
                      )}
                      <button
                        style={s.btnDelete}
                        onClick={() => deleteEmployee(emp.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </SectionCard>
        )}

        {/* Tasks tab */}
        {activeTab === "tasks" && (() => {
          const filteredTasks = works
            .filter(w => taskEmployeeFilter === "all" || String(w.employee) === String(taskEmployeeFilter))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          return (
            <SectionCard
              title={`All Tasks (${filteredTasks.length})`}
              action={
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#555" }}>Employee:</span>
                  <select
                    value={taskEmployeeFilter}
                    onChange={(e) => setTaskEmployeeFilter(e.target.value)}
                    style={{ ...s.input, width: "auto", padding: "4px 8px" }}
                  >
                    <option value="all">All Employees</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.username}</option>
                    ))}
                  </select>
                </div>
              }
            >
              {filteredTasks.length === 0 && <p style={s.emptyText}>No tasks found</p>}
              {filteredTasks.map((work, i) => (
                <React.Fragment key={work.id}>
                  {i > 0 && <Divider />}
                  <div style={s.taskRow} className="dashboard-task-row">
                    <div style={{ ...s.statusBar, background: STATUS_META[work.status]?.bar }} />

                    {editingWorkId === work.id ? (
                      <div style={{ flex: 1, paddingLeft: 12 }} className="dashboard-formGroup">
                        <input
                          style={s.input}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Task title"
                        />
                        <input
                          style={s.input}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description"
                        />
                        <input
                          type="date"
                          style={s.input}
                          value={editCompletionDate}
                          onChange={(e) => setEditCompletionDate(e.target.value)}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button style={s.btnSave} onClick={updateWork}>Save</button>
                          <button style={s.btnCancel} onClick={() => setEditingWorkId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={s.taskLeft}>
                        <div style={s.taskTitle}>{work.title}</div>
                        <div style={s.taskDesc}>{work.description}</div>
                        <div style={s.taskMeta}>
                          <span style={s.taskEmployee}>
                            To: {employeeMap[work.employee] || "Unassigned"}
                          </span>
                          <span style={s.taskEmployee}>
                            By: {contactMap[work.manager] || managerProfile?.username}
                          </span>
                          <span style={s.taskEmployee}>
                            Assigned: {new Date(work.created_at).toLocaleDateString()}
                          </span>
                          {work.completion_date && (
                            <span style={s.taskEmployee}>
                              Due: {new Date(work.completion_date).toLocaleDateString()}
                            </span>
                          )}
                          <Badge status={work.status} />
                        </div>
                      </div>
                    )}

                    {editingWorkId !== work.id && work.status !== "completed" && (
                      <div style={s.taskActions} className="dashboard-task-actions">
                        <button style={s.btnEdit} onClick={() => startEdit(work)}>Edit</button>
                        <button style={s.btnDelete} onClick={() => deleteWork(work.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              ))}
            </SectionCard>
          )
        })()}

        {/* Assign tab */}
        {activeTab === "assign" && (
          <div style={{ maxWidth: 560 }}>
            <SectionCard title="New Task">
              <div style={s.formGroup}>
                <label style={s.label}>Task Title</label>
                <input
                  style={s.input}
                  placeholder="e.g. Update documentation"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Description</label>
                <textarea
                  style={{ ...s.input, ...s.textarea }}
                  placeholder="Describe what needs to be done..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Assign To</label>
                <select
                  style={s.input}
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                >
                  <option value="">Select an employee</option>
                  {employees
                    .filter((e) => e.is_approved)
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.username}
                      </option>
                    ))}
                </select>
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Completion Date</label>
                <input
                  type="date"
                  style={s.input}
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                />
              </div>
              <button
                style={{ ...s.btnAssign, opacity: assignLoading ? 0.7 : 1 }}
                onClick={assignWork}
                disabled={assignLoading}
              >
                {assignLoading ? "Assigning..." : "Assign Task"}
              </button>
            </SectionCard>
          </div>
        )}

        {activeTab === "completed" && (() => {
          // Show ALL completed works sorted newest first — month picker only filters the CSV download
          const completedWorks = works
            .filter((w) => {
              if (w.status !== "completed") return false;
              if (reportEmployeeFilter !== "all" && String(w.employee) !== String(reportEmployeeFilter)) return false;
              const dateStr = w.completed_at || w.created_at;
              return dateStr && dateStr.startsWith(reportMonth);
            })
            .sort((a, b) => {
              const da = new Date(b.completed_at || b.created_at);
              const db = new Date(a.completed_at || a.created_at);
              return da - db;
            });

          return (
            <SectionCard
              title={`Completed Reports (${completedWorks.length} total)`}
              action={
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "#555" }}>Month:</span>
                  <input
                    type="month"
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                    style={{ ...s.input, margin: 0, padding: "4px 8px", width: "auto" }}
                  />
                  <span style={{ fontSize: 13, color: "#555" }}>Employee:</span>
                  <select
                    value={reportEmployeeFilter}
                    onChange={(e) => setReportEmployeeFilter(e.target.value)}
                    style={{ ...s.input, width: "auto", padding: "4px 8px" }}
                  >
                    <option value="all">All Employees</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.username}</option>
                    ))}
                  </select>
                  <button style={{ ...s.btnSave, padding: "6px 14px", whiteSpace: "nowrap" }} onClick={downloadCompletedPDF}>
                    ⬇ Download PDF
                  </button>
                </div>
              }
            >
              {completedWorks.length === 0 && <p style={s.emptyText}>No completed tasks yet</p>}
              {completedWorks.map((work, i) => {
                const dateKey = (work.completed_at || work.created_at || "").slice(0, 7);
                const prevDateKey = i > 0 ? (completedWorks[i - 1].completed_at || completedWorks[i - 1].created_at || "").slice(0, 7) : null;
                const showMonthHeader = dateKey !== prevDateKey;
                return (
                  <React.Fragment key={work.id}>
                    {showMonthHeader && (
                      <div style={{ padding: "10px 0 4px 0", fontWeight: 600, fontSize: 13, color: "#378ADD", letterSpacing: "0.05em" }}>
                        {new Date(dateKey + "-01").toLocaleString("default", { month: "long", year: "numeric" })}
                      </div>
                    )}
                    {i > 0 && !showMonthHeader && <Divider />}
                    <div style={s.taskRow}>
                      <div style={{ ...s.statusBar, background: STATUS_META[work.status]?.bar }} />
                      <div style={s.taskLeft}>
                        <div style={s.taskTitle}>{work.title}</div>
                        <div style={s.taskDesc}>{work.description}</div>
                        {work.work_report && (
                          <div style={s.reportPreview}>Report: {work.work_report}</div>
                        )}
                        <div style={s.taskMeta}>
                          <span style={s.taskEmployee}>
                            To: {employeeMap[work.employee] || "Unassigned"}
                          </span>
                          <span style={s.taskEmployee}>
                            Start (Assigned): {new Date(work.created_at).toLocaleString()}
                          </span>
                          <span style={s.taskEmployee}>
                            End (Completed): {work.completed_at ? new Date(work.completed_at).toLocaleString() : "—"}
                          </span>
                          {work.completion_date && (
                            <span style={s.taskEmployee}>
                              Due: {new Date(work.completion_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </SectionCard>
          )
        })()}


        {activeTab === "messages" && (
          <div style={s.messageGrid} className="dashboard-message-grid">
            <SectionCard title={`People (${messagingContacts.length})`} className={`chat-contacts-panel ${selectedContact ? "has-selected" : ""}`}>
              {messagingContacts.length === 0 && (
                <p style={s.emptyText}>No approved users available to message</p>
              )}
              {messagingContacts.map((emp, i) => {
                const ac = AVATAR_COLORS[i % AVATAR_COLORS.length];
                const summary = contactSummaries[emp.id] || {};
                return (
                  <button
                    key={emp.id}
                    style={{
                      ...s.contactRow,
                      ...(String(selectedContact) === String(emp.id) ? s.contactRowActive : {}),
                    }}
                    onClick={() => setSelectedContact(emp.id)}
                  >
                    <span style={{ ...s.contactAvatar, background: ac.bg, color: ac.color }}>
                      {initials(emp.username)}
                    </span>
                    <span style={s.contactInfo}>
                      <span style={s.contactNameRow}>
                        <span style={s.empName}>{emp.username}</span>
                        {summary.unread_count > 0 && (
                          <span style={s.contactUnreadBadge}>{summary.unread_count}</span>
                        )}
                      </span>
                      <span style={summary.unread_count > 0 ? s.contactUnreadText : s.empEmail}>
                        {summary.unread_count > 0
                          ? `${summary.unread_count} unread`
                          : summary.status || "No messages"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </SectionCard>

            <SectionCard
              title={
                selectedContact
                  ? `Chat with ${contactMap[selectedContact] || "Person"}`
                  : "Private Chat"
              }
              className={`chat-window-panel ${selectedContact ? "has-selected" : ""}`}
              action={
                <div style={s.chatHeaderActions}>
                  <span style={s.messageCount}>
                    {selectedUnreadCount} unread received
                  </span>
                  <span style={s.secureChip}>Encrypted at rest</span>
                </div>
              }
            >
              {!selectedContact && (
                <p style={s.emptyText}>Select a person to view messages</p>
              )}

              {selectedContact && (
                <>
                  <button className="back-to-people-btn" onClick={() => setSelectedContact("")}>
                    ← Back to People
                  </button>
                  <div style={s.messageList} className="dashboard-messageList" ref={scrollContainerRef}>
                    {messageLoading && <p style={s.emptyText}>Loading messages...</p>}
                    {!messageLoading && messages.length === 0 && (
                      <p style={s.emptyText}>No messages yet</p>
                    )}
                    {!messageLoading &&
                      messages.map((msg) => {
                        const isMine = String(msg.sender) === String(managerId);
                        return (
                          <div
                            key={msg.id}
                            style={{
                              ...s.messageBubbleWrap,
                              justifyContent: isMine ? "flex-end" : "flex-start",
                            }}
                            className="dashboard-messageBubbleWrap"
                          >
                            <div style={{ ...s.messageBubble, ...(isMine ? s.messageMine : s.messageTheirs) }} className="dashboard-messageBubble">
                              {editingMessageId === msg.id ? (
                                <>
                                  <textarea
                                    style={s.editMessageInput}
                                    value={editingMessageBody}
                                    onChange={(e) => setEditingMessageBody(e.target.value)}
                                  />
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
                                    {msg.edited_at && " - Edited"}
                                    {isMine && ` - ${msg.seen_at ? "Seen" : "Delivered"}`}
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
                    <textarea
                      style={{ ...s.input, ...s.messageInput }}
                      className="dashboard-messageInput"
                      placeholder="Write a private message..."
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                    />
                    <button style={s.btnSend} onClick={sendMessage}>Send</button>
                  </div>
                </>
              )}
            </SectionCard>
          </div>
        )}
      </main>
    </div>
  );
};

export default ManagerDashboard;

/* Styles */

const s = {
  /* Layout */
  container: {
    display: "flex",
    minHeight: "100vh",
    background: "#f4f7fb",
    fontFamily: "'Plus Jakarta Sans', Arial, sans-serif",
    position: "relative",
  },

  /* Toast */
  toast: {
    position: "fixed",
    top: 20,
    right: 20,
    zIndex: 9999,
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
  },
  toast_success: { background: "#EAF3DE", color: "#3B6D11" },
  toast_danger: { background: "#FCEBEB", color: "#A32D2D" },
  toast_warning: { background: "#FAEEDA", color: "#854F0B" },
  messagePopup: {
    position: "fixed",
    top: 18,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 9998,
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
  },

  /* Sidebar */
  sidebar: {
    width: 220,
    background: "#0f172a",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "24px 12px",
    flexShrink: 0,
    minHeight: "100vh",
  },
  sidebarTop: { display: "flex", flexDirection: "column", gap: 32 },
  logo: { display: "flex", alignItems: "center", gap: 10, padding: "0 8px" },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "#185FA5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Syne', sans-serif",
    fontWeight: 700,
    fontSize: 16,
    color: "#B5D4F4",
  },
  logoText: {
    fontFamily: "'Syne', sans-serif",
    fontWeight: 700,
    fontSize: 16,
    color: "#f8fafc",
  },

  nav: { display: "flex", flexDirection: "column", gap: 2 },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    width: "100%",
    position: "relative",
  },
  navItemActive: { background: "#1e293b", color: "#f8fafc" },
  navIcon: { fontSize: 14, width: 18, textAlign: "center" },
  navBadge: {
    marginLeft: "auto",
    background: "#EF9F27",
    color: "#633806",
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 20,
  },
  logoutBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#64748b",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  /* Main */
  main: { flex: 1, padding: "28px 28px", overflowY: "auto" },
  pageHeader: { marginBottom: 24 },
  pageTitle: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 22,
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
  },
  pageSubtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },

  /* Stats grid */
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    background: "#fff",
    border: "0.5px solid #e2e8f0",
    borderRadius: 12,
    padding: 16,
    position: "relative",
    overflow: "hidden",
  },
  statAccent: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 3,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#94a3b8",
    marginBottom: 6,
  },
  statValue: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 28,
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1,
  },
  statSub: { fontSize: 11, color: "#94a3b8", marginTop: 4 },

  /* Card */
  card: {
    background: "#fff",
    border: "0.5px solid #e2e8f0",
    borderRadius: 12,
    padding: "20px",
    marginBottom: 20,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 15,
    fontWeight: 700,
    color: "#0f172a",
  },
  divider: { height: "0.5px", background: "#e2e8f0", margin: "0 0" },

  /* Overview rows */
  overviewRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 0",
    position: "relative",
  },
  statusBar: {
    width: 3,
    height: 36,
    borderRadius: 2,
    flexShrink: 0,
  },
  overviewLeft: { flex: 1, display: "flex", flexDirection: "column", gap: 2 },
  overviewTitle: { fontSize: 13, fontWeight: 600, color: "#0f172a" },
  overviewEmployee: { fontSize: 11, color: "#94a3b8" },

  /* Employee rows */
  empRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 0",
  },
  empAvatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Syne', sans-serif",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  empInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 2 },
  empName: { fontSize: 13, fontWeight: 600, color: "#0f172a" },
  empEmail: { fontSize: 11, color: "#64748b" },
  empStatus: { flexShrink: 0 },
  approvedChip: {
    fontSize: 10, fontWeight: 600,
    padding: "3px 8px", borderRadius: 20,
    background: "#EAF3DE", color: "#3B6D11",
  },
  pendingChip: {
    fontSize: 10, fontWeight: 600,
    padding: "3px 8px", borderRadius: 20,
    background: "#FAEEDA", color: "#854F0B",
  },
  empActions: { display: "flex", gap: 6, flexShrink: 0 },

  /* Task rows */
  taskRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 0",
  },
  taskLeft: { flex: 1, paddingLeft: 12 },
  taskTitle: { fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 3 },
  taskDesc: { fontSize: 12, color: "#64748b", lineHeight: 1.5, marginBottom: 8 },
  taskMeta: { display: "flex", alignItems: "center", gap: 8 },
  taskEmployee: {
    fontSize: 11, fontWeight: 500, color: "#64748b",
    background: "#f1f5f9",
    padding: "2px 8px", borderRadius: 20,
  },
  taskActions: { display: "flex", gap: 6, flexShrink: 0, paddingTop: 2 },

  /* Badge */
  badge: {
    fontSize: 10, fontWeight: 600,
    padding: "3px 8px", borderRadius: 20,
    display: "inline-flex", alignItems: "center", gap: 4,
  },
  badgeDot: { width: 5, height: 5, borderRadius: "50%" },

  /* Form */
  formGroup: { marginBottom: 16 },
  label: {
    display: "block",
    fontSize: 12, fontWeight: 600,
    color: "#475569",
    marginBottom: 6,
    letterSpacing: "0.02em",
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    fontSize: 13,
    color: "#0f172a",
    background: "#f8fafc",
    border: "0.5px solid #cbd5e1",
    borderRadius: 8,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    marginBottom: 0,
  },
  textarea: { minHeight: 80, resize: "vertical" },

  /* Buttons */
  btnApprove: {
    fontSize: 11, fontWeight: 600,
    padding: "6px 12px", borderRadius: 7,
    border: "none", cursor: "pointer",
    background: "#3B6D11", color: "#EAF3DE",
    fontFamily: "inherit",
  },
  btnDelete: {
    fontSize: 11, fontWeight: 600,
    padding: "6px 12px", borderRadius: 7,
    border: "none", cursor: "pointer",
    background: "#FCEBEB", color: "#A32D2D",
    fontFamily: "inherit",
  },
  btnEdit: {
    fontSize: 11, fontWeight: 600,
    padding: "6px 12px", borderRadius: 7,
    border: "0.5px solid #cbd5e1", cursor: "pointer",
    background: "#fff", color: "#475569",
    fontFamily: "inherit",
  },
  btnSave: {
    fontSize: 12, fontWeight: 600,
    padding: "7px 16px", borderRadius: 7,
    border: "none", cursor: "pointer",
    background: "#185FA5", color: "#E6F1FB",
    fontFamily: "inherit",
  },
  btnCancel: {
    fontSize: 12, fontWeight: 600,
    padding: "7px 14px", borderRadius: 7,
    border: "0.5px solid #cbd5e1", cursor: "pointer",
    background: "#fff", color: "#475569",
    fontFamily: "inherit",
  },
  btnAssign: {
    width: "100%",
    padding: "11px",
    fontSize: 13, fontWeight: 600,
    borderRadius: 8,
    border: "none", cursor: "pointer",
    background: "#185FA5", color: "#E6F1FB",
    fontFamily: "'Syne', sans-serif",
    marginTop: 4,
    letterSpacing: "0.02em",
  },

  /* Messages */
  messageGrid: {
    display: "grid",
    gridTemplateColumns: "280px minmax(0, 1fr)",
    gap: 16,
    alignItems: "start",
  },
  contactRow: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px",
    border: "0.5px solid transparent",
    borderRadius: 8,
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  },
  contactRowActive: {
    background: "#f1f5f9",
    borderColor: "#cbd5e1",
  },
  contactAvatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Syne', sans-serif",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  contactInfo: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  contactNameRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minWidth: 0,
  },
  contactUnreadBadge: {
    minWidth: 22,
    height: 20,
    padding: "0 7px",
    borderRadius: 20,
    background: "#185FA5",
    color: "#E6F1FB",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 800,
    flexShrink: 0,
  },
  contactUnreadText: {
    fontSize: 11,
    color: "#185FA5",
    fontWeight: 800,
  },
  secureChip: {
    fontSize: 10,
    fontWeight: 700,
    color: "#0F6E56",
    background: "#E1F5EE",
    borderRadius: 20,
    padding: "4px 9px",
  },
  chatHeaderActions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  messageCount: {
    fontSize: 10,
    fontWeight: 700,
    color: "#475569",
    background: "#f1f5f9",
    borderRadius: 20,
    padding: "4px 9px",
  },
  messageList: {
    minHeight: 320,
    maxHeight: 420,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "12px",
    border: "0.5px solid #e2e8f0",
    borderRadius: 8,
    background: "#f8fafc",
  },
  messageBubbleWrap: { display: "flex" },
  messageBubble: {
    maxWidth: "72%",
    borderRadius: 8,
    padding: "9px 11px",
    fontSize: 13,
    lineHeight: 1.45,
  },
  messageMine: { background: "#185FA5", color: "#E6F1FB" },
  messageTheirs: {
    background: "#fff",
    color: "#0f172a",
    border: "0.5px solid #e2e8f0",
  },
  messageText: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  messageMeta: { fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: "right" },
  messageActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 6,
  },
  messageTinyBtn: {
    border: "0.5px solid rgba(100, 116, 139, 0.35)",
    borderRadius: 6,
    background: "rgba(255,255,255,0.18)",
    color: "inherit",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 700,
    padding: "3px 7px",
  },
  editMessageInput: {
    width: "100%",
    minHeight: 56,
    resize: "vertical",
    border: "0.5px solid rgba(100, 116, 139, 0.35)",
    borderRadius: 6,
    padding: 8,
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: 13,
  },
  messageComposer: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
    marginTop: 12,
    alignItems: "end",
  },
  messageInput: { minHeight: 58, resize: "vertical", marginBottom: 0 },
  btnSend: {
    fontSize: 12,
    fontWeight: 700,
    padding: "11px 18px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    background: "#185FA5",
    color: "#E6F1FB",
    fontFamily: "inherit",
  },

  /* Misc */
  emptyText: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13,
    padding: "24px 0",
  },
};

