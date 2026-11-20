diff -ruN /tmp/orig/src/locales/ar/servers.json src/locales/ar/servers.json
--- /tmp/orig/src/locales/ar/servers.json	2026-11-20 06:41:01.000000000 +0000
+++ src/locales/ar/servers.json	2026-11-20 08:31:18.695843359 +0000
@@ -93,7 +93,8 @@
     "copied": "تم نسخ {{label}}",
     "copyFailed": "فشل النسخ",
     "copyBlocked": "حظر المتصفح الوصول إلى الحافظة",
-    "copyAria": "نسخ {{label}}"
+    "copyAria": "نسخ {{label}}",
+    "unexpectedError": "حدث خطأ غير متوقع"
   },
   "card": {
     "httpsOrigin": "الأصل عبر HTTPS",
@@ -165,8 +166,8 @@
       "httpsOrigin": "الأصل عبر HTTPS",
       "lastCheck": "آخر فحص صحة",
       "guard": {
-        "tunnelUp": "النفق مفتوح",
-        "tunnelDown": "النفق مغلق",
+        "tunnelUp": "النفق يعمل",
+        "tunnelDown": "النفق متوقف",
         "connected": "متصل",
         "disconnected": "منقطع",
         "lastHeartbeat": "آخر نبضة",
@@ -197,6 +198,47 @@
       "tunnelEnabled": "تم تفعيل النفق",
       "enableTunnel": "تفعيل النفق",
       "tunnelActiveHint": "نفق الوكيل نشط."
+    },
+    "agent": {
+      "state": {
+        "notInstalled": "الـ Agent غير مثبّت",
+        "connected": "متصل",
+        "unstable": "غير مستقر",
+        "disconnected": "غير متصل"
+      },
+      "stateHint": {
+        "notInstalled": "فعّل النفق للحصول على أمر التثبيت.",
+        "connected": "النفق يعمل وآخر نبضة حديثة.",
+        "unstable": "النفق يبدو يعمل لكن آخر نبضة قديمة.",
+        "disconnected": "النفق غير متصل أو لا توجد بيانات حديثة صالحة."
+      },
+      "tokenIssued": "تم إصدار التوكن",
+      "tokenNotIssued": "لا يوجد توكن",
+      "heartbeatFresh": "النبضة حديثة",
+      "heartbeatStale": "النبضة قديمة",
+      "os": "النظام",
+      "peerIp": "عنوان نظير النفق",
+      "cpu": "المعالج (CPU)",
+      "ram": "الذاكرة (RAM)",
+      "disk": "القرص",
+      "load": "الحمل (دقيقة)",
+      "estimatedMaxRps": "أقصى سعة مقدّرة",
+      "originHealth": "صحة الأصل (Origin)",
+      "originOk": "متاح",
+      "originDown": "غير متاح",
+      "rotate": "تدوير التوكن",
+      "disable": "تعطيل الـ Agent",
+      "rotateConfirm": "تدوير التوكن يُبطل التوكن الحالي ويجب إعادة تثبيت الـ Agent بالأمر الجديد. هل تريد المتابعة؟",
+      "disableConfirm": "هل تريد تعطيل الـ Agent وإلغاء التوكن؟ سيتوقف النفق.",
+      "rotated": "تم تدوير التوكن",
+      "disabled": "تم تعطيل الـ Agent",
+      "enableFailed": "فشل تفعيل النفق",
+      "rotateFailed": "فشل تدوير التوكن",
+      "disableFailed": "فشل تعطيل الـ Agent",
+      "installTitle": "أمر تثبيت الـ Agent",
+      "runOnServer": "شغّل هذا الأمر على السيرفر (بصلاحية root) لتثبيت الـ Agent.",
+      "backToUi": "ثم ارجع هنا لمتابعة حالة الـ Agent والنفق.",
+      "docs": "دليل التثبيت"
     }
   },
   "dns": {
@@ -329,7 +371,8 @@
       "tunnelEnabledDesc": "تم تفعيل نفق الوكيل.",
       "tunnelEnableFailed": "فشل تفعيل النفق",
       "updateFailed": "تعذّر تحديث السيرفر",
-      "addFailed": "تعذّر إضافة السيرفر"
+      "addFailed": "تعذّر إضافة السيرفر",
+      "tunnelFailed": "تم إنشاء السيرفر لكن فشل تفعيل النفق"
     }
   },
   "validation": {
@@ -351,5 +394,10 @@
       "range": "يجب أن يكون المنفذ بين 1 و65535",
       "reserved": "هذا المنفذ محجوز لخدمة غير ويب ولا يمكن استخدامه كأصل"
     }
+  },
+  "errors": {
+    "PROBE_NOT_AVAILABLE_FOR_GUARD": "الفحص (Probe) غير متاح لسيرفرات Guard.",
+    "FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE": "هذه الميزة غير متاحة لنوع إعداد هذا السيرفر.",
+    "ORIGIN_FIELDS_NOT_ALLOWED_FOR_GUARD": "حقول الـ Origin غير مسموحة لسيرفرات Guard."
   }
 }
diff -ruN /tmp/orig/src/locales/ar/team.json src/locales/ar/team.json
--- /tmp/orig/src/locales/ar/team.json	2026-11-20 00:17:37.000000000 +0000
+++ src/locales/ar/team.json	2026-11-20 08:38:40.558719082 +0000
@@ -98,7 +98,17 @@
     "emptyTitle": "لا توجد مجموعات",
     "emptyDesc": "أنشئ أول مجموعة صلاحيات لتنظيم وصول الفريق.",
     "noResults": "لا توجد نتائج",
-    "searchPlaceholder": "ابحث بالاسم أو الوصف…"
+    "searchPlaceholder": "ابحث بالاسم أو الوصف…",
+    "viewMembers": "عرض الأعضاء",
+    "selectMember": "اختر عضوًا…",
+    "addMember": "إضافة",
+    "memberAdded": "تمت إضافة العضو إلى المجموعة",
+    "memberAddFailed": "فشلت إضافة العضو",
+    "removeMember": "إزالة من المجموعة",
+    "removeMemberConfirm": "هل تريد إزالة هذا العضو من المجموعة؟",
+    "memberRemoved": "تمت إزالة العضو من المجموعة",
+    "memberRemoveFailed": "فشلت إزالة العضو",
+    "noMembers": "لا يوجد أعضاء في هذه المجموعة بعد"
   },
   "invite": {
     "columns": {
@@ -134,9 +144,11 @@
     "emptyTitle": "لا توجد دعوات",
     "emptyDesc": "ادعُ أعضاء جدد للانضمام إلى الفريق.",
     "noResults": "لا توجد نتائج",
-    "searchPlaceholder": "ابحث بالبريد الإلكتروني…"
+    "searchPlaceholder": "ابحث بالبريد الإلكتروني…",
+    "resend": "إعادة إرسال الدعوة",
+    "revoke": "إلغاء الدعوة"
   },
   "actions": {
     "cancel": "إلغاء"
   }
-}
\ No newline at end of file
+}
diff -ruN /tmp/orig/src/locales/en/servers.json src/locales/en/servers.json
--- /tmp/orig/src/locales/en/servers.json	2026-11-20 06:39:57.000000000 +0000
+++ src/locales/en/servers.json	2026-11-20 08:31:18.693975884 +0000
@@ -89,7 +89,8 @@
     "copied": "{{label}} copied",
     "copyFailed": "Copy failed",
     "copyBlocked": "Your browser blocked clipboard access",
-    "copyAria": "Copy {{label}}"
+    "copyAria": "Copy {{label}}",
+    "unexpectedError": "An unexpected error occurred"
   },
   "card": {
     "httpsOrigin": "HTTPS origin",
@@ -161,8 +162,8 @@
       "httpsOrigin": "HTTPS origin",
       "lastCheck": "Last health check",
       "guard": {
-        "tunnelUp": "Tunnel",
-        "tunnelDown": "Tunnel",
+        "tunnelUp": "Tunnel up",
+        "tunnelDown": "Tunnel down",
         "connected": "Connected",
         "disconnected": "Disconnected",
         "lastHeartbeat": "Last heartbeat",
@@ -193,6 +194,47 @@
       "tunnelEnabled": "Tunnel enabled",
       "enableTunnel": "Enable Tunnel",
       "tunnelActiveHint": "The Agent tunnel is active."
+    },
+    "agent": {
+      "state": {
+        "notInstalled": "Agent not installed",
+        "connected": "Connected",
+        "unstable": "Unstable",
+        "disconnected": "Disconnected"
+      },
+      "stateHint": {
+        "notInstalled": "Enable the tunnel to get the install command.",
+        "connected": "Tunnel is up and the heartbeat is recent.",
+        "unstable": "Tunnel reports up, but the last heartbeat is stale.",
+        "disconnected": "The tunnel is down or no valid recent data was received."
+      },
+      "tokenIssued": "Token issued",
+      "tokenNotIssued": "No token",
+      "heartbeatFresh": "Heartbeat fresh",
+      "heartbeatStale": "Heartbeat stale",
+      "os": "System",
+      "peerIp": "Tunnel peer IP",
+      "cpu": "CPU",
+      "ram": "RAM",
+      "disk": "Disk",
+      "load": "Load (1m)",
+      "estimatedMaxRps": "Estimated max capacity",
+      "originHealth": "Origin health",
+      "originOk": "Reachable",
+      "originDown": "Unreachable",
+      "rotate": "Rotate token",
+      "disable": "Disable agent",
+      "rotateConfirm": "Rotating the token invalidates the current one. The agent must be reinstalled with the new command. Continue?",
+      "disableConfirm": "Disable the agent and revoke its token? The tunnel will go down.",
+      "rotated": "Token rotated",
+      "disabled": "Agent disabled",
+      "enableFailed": "Failed to enable the tunnel",
+      "rotateFailed": "Failed to rotate the token",
+      "disableFailed": "Failed to disable the agent",
+      "installTitle": "Agent install command",
+      "runOnServer": "Run this command on your server (as root) to install the agent.",
+      "backToUi": "Then come back here to follow the agent and tunnel status.",
+      "docs": "Installation guide"
     }
   },
   "dns": {
@@ -325,7 +367,8 @@
       "tunnelEnabledDesc": "The Agent tunnel has been enabled.",
       "tunnelEnableFailed": "Failed to enable tunnel",
       "updateFailed": "Could not update server",
-      "addFailed": "Could not add server"
+      "addFailed": "Could not add server",
+      "tunnelFailed": "Server created, but enabling the tunnel failed"
     }
   },
   "validation": {
@@ -347,5 +390,10 @@
       "range": "Port must be between 1 and 65535",
       "reserved": "This port is reserved for a non-web service and can’t be used as an origin"
     }
+  },
+  "errors": {
+    "PROBE_NOT_AVAILABLE_FOR_GUARD": "Probe is not available for Guard servers.",
+    "FEATURE_NOT_AVAILABLE_FOR_SETUP_MODE": "This feature is not available for this server's setup mode.",
+    "ORIGIN_FIELDS_NOT_ALLOWED_FOR_GUARD": "Origin fields are not allowed for Guard servers."
   }
 }
diff -ruN /tmp/orig/src/locales/en/team.json src/locales/en/team.json
--- /tmp/orig/src/locales/en/team.json	2026-11-20 00:17:53.000000000 +0000
+++ src/locales/en/team.json	2026-11-20 08:38:40.558231926 +0000
@@ -98,7 +98,17 @@
     "emptyTitle": "No groups yet",
     "emptyDesc": "Create your first permission group to organize team access.",
     "noResults": "No results",
-    "searchPlaceholder": "Search by name or description…"
+    "searchPlaceholder": "Search by name or description…",
+    "viewMembers": "View members",
+    "selectMember": "Select a member…",
+    "addMember": "Add",
+    "memberAdded": "Member added to group",
+    "memberAddFailed": "Failed to add member",
+    "removeMember": "Remove from group",
+    "removeMemberConfirm": "Remove this member from the group?",
+    "memberRemoved": "Member removed from group",
+    "memberRemoveFailed": "Failed to remove member",
+    "noMembers": "No members in this group yet"
   },
   "invite": {
     "columns": {
@@ -134,9 +144,11 @@
     "emptyTitle": "No invites yet",
     "emptyDesc": "Invite new members to join the team.",
     "noResults": "No results",
-    "searchPlaceholder": "Search by email…"
+    "searchPlaceholder": "Search by email…",
+    "resend": "Resend invitation",
+    "revoke": "Revoke invitation"
   },
   "actions": {
     "cancel": "Cancel"
   }
-}
\ No newline at end of file
+}
diff -ruN /tmp/orig/src/pages/ServersPage.tsx src/pages/ServersPage.tsx
--- /tmp/orig/src/pages/ServersPage.tsx	2026-11-20 00:03:01.000000000 +0000
+++ src/pages/ServersPage.tsx	2026-11-20 08:37:42.349289755 +0000
@@ -381,13 +381,21 @@
     }
   }
 
+  /** Origin-only: DNS instructions / verify belong to ORIGIN servers. Decided by the server's real setupMode. */
+  const openDns = (server: Server, dns: DnsInstructions | null = null) => {
+    if (server.setupMode === 'GUARD') return
+    setDnsState({ server, dns })
+  }
+
   /** Re-measure capacity: POST /probe → 202, the numbers arrive via Socket / polling */
   const handleProbe = async (server: Server) => {
     if (probingIds.has(server.id)) return
+    // Probe is Origin-only (backend: PROBE_NOT_AVAILABLE_FOR_GUARD)
+    if (server.setupMode === 'GUARD') return
 
     if (!server.dnsVerified) {
       toast.info(t('toast.verifyFirst'), t('toast.verifyFirstDesc'))
-      setDnsState({ server, dns: null })
+      openDns(server)
       return
     }
 
@@ -399,7 +407,7 @@
       const { status: httpStatus, code, message, retryAfterSec } = getApiErrorInfo(err)
       if (httpStatus === 409 || code === 'OWNERSHIP_REQUIRED') {
         toast.info(t('toast.verifyFirst'), message)
-        setDnsState({ server, dns: null })
+        openDns(server)
       } else if (httpStatus === 429 || code === 'PROBE_TOO_FREQUENT') {
         toast.info(
           retryAfterSec ? t('toast.waitSeconds', { s: retryAfterSec }) : t('toast.waitGeneric'),
@@ -420,7 +428,7 @@
     setServers((prev) => (prev.some((s) => s.id === server.id) ? prev.map((s) => (s.id === server.id ? server : s)) : prev))
     stopProbing(server.id)
     void load(true)
-    if (dns) setDnsState({ server, dns })
+    if (dns) openDns(server, dns)
   }
 
   /** verify result updates the card without a full reload */
@@ -455,8 +463,9 @@
   }
 
   const openDnsFromDrawer = (server: Server) => {
+    if (server.setupMode === 'GUARD') return
     setDetail(null)
-    setDnsState({ server, dns: null })
+    openDns(server)
   }
 
   // ---------------- Fleet health (from the backend summary) ----------------
@@ -732,7 +741,7 @@
                 canManage={canManage}
                 busy={busyId === server.id}
                 probing={probingIds.has(server.id)}
-                onDns={() => setDnsState({ server, dns: null })}
+                onDns={() => openDns(server)}
                 onEdit={() => setFormState({ open: true, server })}
                 onDelete={() => setDeleting(server)}
                 onMaintenance={() => void handleMaintenance(server)}
diff -ruN /tmp/orig/src/pages/TeamPage.tsx src/pages/TeamPage.tsx
--- /tmp/orig/src/pages/TeamPage.tsx	2026-11-20 06:27:43.000000000 +0000
+++ src/pages/TeamPage.tsx	2026-11-20 08:38:40.557564949 +0000
@@ -139,7 +139,7 @@
 function StatusBadge({ status }: { status: string }) {
   const meta = INVITE_STATUS_META[status] ?? { label: status, tone: 'slate' as const }
   const { t } = useTranslation('team')
-  return <Badge tone={meta.tone} dot>{t(`inviteStatus.${status.toLowerCase()}`) ?? meta.label}</Badge>
+  return <Badge tone={meta.tone} dot>{t(`invite.status.${status.toLowerCase()}`, { defaultValue: meta.label })}</Badge>
 }
 
 function SkeletonRow({ cols = 4 }: { cols?: number }) {
@@ -176,11 +176,28 @@
   const [overrides, setOverrides] = useState<Record<string, boolean>>({})
   const [groupsList, setGroupsList] = useState<Array<{ id: string; name: string }>>([])
   const [permissionsCatalog, setPermissionsCatalog] = useState<Array<{ id: string; label: string; description: string }>>([])
+  // Fresh copy from GET /team/members/:id - the list row passed as `member` goes stale after actions
+  const [detail, setDetail] = useState<Member | null>(null)
+  const current = detail ?? member
+
+  const applyMember = (md: Member) => {
+    setDetail(md)
+    setRole(md.role ?? '')
+    setSelectedGroups(md.groups.map((g) => g.id))
+    const ov: Record<string, boolean> = {}
+    for (const o of md.overrides) ov[o.permission] = o.isDeny
+    setOverrides(ov)
+  }
+  const refresh = async () => {
+    if (!member) return
+    applyMember(await getMember(member.id))
+  }
 
   // Load member details when opened
   useEffect(() => {
     if (!open || !member) return
     let cancelled = false
+    setDetail(null)
     setLoading(true)
     Promise.all([
       getMember(member.id),
@@ -189,17 +206,8 @@
     ])
       .then(([memberData, catalog, groupsRes]) => {
         if (cancelled) return
-        setRole(memberData.role ?? '')
-        // Defensive: back-end getMember may not include `overrides`; service normalises,
-        // but keep component-level defaults for safety.
-        const groups = Array.isArray(memberData.groups) ? memberData.groups : []
-        setSelectedGroups(groups.map((g) => g.id))
-        const ov: Record<string, boolean> = {}
-        const overrides = Array.isArray(memberData.overrides) ? memberData.overrides : []
-        for (const o of overrides) {
-          ov[o.permission] = o.isDeny
-        }
-        setOverrides(ov)
+        // teamService.getMember already normalises groups/overrides/permissions to arrays
+        applyMember(memberData)
         setGroupsList(groupsRes.items.map((g) => ({ id: g.id, name: g.name })))
         setPermissionsCatalog(catalog.permissions)
       })
@@ -222,6 +230,7 @@
     try {
       await updateMemberRole(member.id, { role: newRole as any })
       toast.success(t('member.roleUpdated'))
+      await refresh()
       onMemberUpdated()
     } catch (err) {
       const { message } = parseApiError(err)
@@ -237,6 +246,7 @@
     try {
       await setMemberGroups(member.id, { groupIds: selectedGroups })
       toast.success(t('member.groupsUpdated'))
+      await refresh()
       onMemberUpdated()
     } catch (err) {
       const { message } = parseApiError(err)
@@ -250,6 +260,7 @@
     if (!member || !canManage) return
     try {
       await upsertUserOverride(member.id, { permission, isDeny })
+      await refresh()
       onMemberUpdated()
     } catch (err) {
       const { message } = parseApiError(err)
@@ -261,6 +272,7 @@
     if (!member || !canManage) return
     try {
       await deleteUserOverride(member.id, permission)
+      await refresh()
       onMemberUpdated()
     } catch (err) {
       const { message } = parseApiError(err)
@@ -274,6 +286,7 @@
     try {
       await activateMember(member.id)
       toast.success(t('member.activated'))
+      await refresh()
       onMemberUpdated()
     } catch (err) {
       const { message } = parseApiError(err)
@@ -289,6 +302,7 @@
     try {
       await deactivateMember(member.id)
       toast.success(t('member.deactivated'))
+      await refresh()
       onMemberUpdated()
     } catch (err) {
       const { message } = parseApiError(err)
@@ -316,8 +330,8 @@
     <Drawer
       open={open}
       onClose={onClose}
-      title={member.fullName || member.email}
-      subtitle={member.email}
+      title={current?.fullName || current?.email || ''}
+      subtitle={current?.email}
       size="lg"
     >
       {loading ? (
@@ -328,8 +342,8 @@
         <div className="space-y-6">
           {/* Status & Role */}
           <div className="flex flex-wrap items-center gap-3">
-            <Badge tone={member.isActive ? 'emerald' : 'rose'} dot>
-              {member.isActive ? t('member.active') : t('member.inactive')}
+            <Badge tone={current!.isActive ? 'emerald' : 'rose'} dot>
+              {current!.isActive ? t('member.active') : t('member.inactive')}
             </Badge>
             <RoleBadge role={role} />
           </div>
@@ -337,7 +351,7 @@
           {/* Actions */}
           {canManage && (
             <div className="flex flex-wrap gap-2 border-t border-white/6 pt-4">
-              {member.isActive ? (
+              {current!.isActive ? (
                 <Button variant="ghost" size="sm" icon={UserMinus} onClick={handleDeactivate} disabled={saving}>
                   {t('member.deactivate')}
                 </Button>
@@ -824,6 +838,149 @@
 }
 
 // ==================================================================
+// Group Drawer: details, permissions, add / remove members (real API calls)
+// ==================================================================
+
+interface GroupDrawerProps {
+  group: PermissionGroup | null
+  onClose: () => void
+  canManage: boolean
+  onChanged: () => void
+}
+
+function GroupDrawer({ group, onClose, canManage, onChanged }: GroupDrawerProps) {
+  const { t } = useTranslation('team')
+  const toast = useToast()
+  const [loading, setLoading] = useState(false)
+  const [busy, setBusy] = useState(false)
+  const [full, setFull] = useState<PermissionGroup | null>(null)
+  const [candidates, setCandidates] = useState<Member[]>([])
+  const [pick, setPick] = useState('')
+  const id = group?.id
+
+  const load = useCallback(async () => {
+    if (!id) return
+    const [g, m] = await Promise.all([getGroup(id), canManage ? listMembers({ limit: 100 }) : Promise.resolve(null)])
+    setFull({ ...g, permissions: Array.isArray(g.permissions) ? g.permissions : [], members: Array.isArray(g.members) ? g.members : [] })
+    setCandidates(m ? m.items : [])
+  }, [id, canManage])
+
+  useEffect(() => {
+    if (!id) {
+      setFull(null)
+      return
+    }
+    let cancelled = false
+    setLoading(true)
+    setPick('')
+    load()
+      .catch((err) => {
+        if (!cancelled) toast.error(t('toast.loadFailed'), parseApiError(err).message)
+      })
+      .finally(() => {
+        if (!cancelled) setLoading(false)
+      })
+    return () => {
+      cancelled = true
+    }
+  }, [id, load, toast, t])
+
+  const run = async (fn: () => Promise<unknown>, okKey: string, failKey: string) => {
+    setBusy(true)
+    try {
+      await fn()
+      toast.success(t(okKey))
+      await load()
+      onChanged()
+    } catch (err) {
+      toast.error(t(failKey), parseApiError(err).message)
+    } finally {
+      setBusy(false)
+    }
+  }
+
+  if (!group) return null
+  const members = full?.members ?? []
+  const memberIds = new Set(members.map((m) => m.id))
+  const addable = candidates.filter((c) => !memberIds.has(c.id))
+
+  return (
+    <Drawer open={!!group} onClose={onClose} title={group.name} subtitle={group.description ?? undefined} size="lg">
+      {loading && !full ? (
+        <div className="space-y-4 p-4">
+          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
+        </div>
+      ) : (
+        <div className="space-y-6">
+          {group.isSystem && <Badge tone="amber">{t('group.system')}</Badge>}
+
+          <Card className="p-4">
+            <h4 className="mb-3 text-sm font-semibold text-white">{t('group.permissions')}</h4>
+            <div className="flex flex-wrap gap-1.5">
+              {(full?.permissions ?? group.permissions).map((p) => (
+                <span key={p} className="rounded-lg bg-white/5 px-2 py-1 font-mono text-xs text-cyan-300">{p}</span>
+              ))}
+            </div>
+          </Card>
+
+          <Card className="p-4">
+            <h4 className="mb-3 text-sm font-semibold text-white">
+              {t('group.columns.members')} ({members.length})
+            </h4>
+
+            {canManage && (
+              <div className="mb-4 flex gap-2">
+                <SelectInput value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1" disabled={busy}>
+                  <option value="">{t('group.selectMember')}</option>
+                  {addable.map((c) => (
+                    <option key={c.id} value={c.id} className="bg-[#0b1224]">{c.fullName || c.email}</option>
+                  ))}
+                </SelectInput>
+                <Button
+                  variant="primary"
+                  size="sm"
+                  icon={UserPlus}
+                  disabled={!pick || busy}
+                  onClick={() => void run(() => addGroupMembers(group.id, { userIds: [pick] }), 'group.memberAdded', 'group.memberAddFailed').then(() => setPick(''))}
+                >
+                  {t('group.addMember')}
+                </Button>
+              </div>
+            )}
+
+            <div className="space-y-2">
+              {members.map((m) => (
+                <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/3 px-3 py-2">
+                  <div className="min-w-0">
+                    <p className="truncate text-sm text-white">{m.fullName || m.email}</p>
+                    <p className="truncate text-xs text-slate-500">{m.email}</p>
+                  </div>
+                  {canManage && (
+                    <Button
+                      variant="ghost"
+                      size="sm"
+                      icon={UserMinus}
+                      disabled={busy}
+                      aria-label={t('group.removeMember')}
+                      className="text-rose-400 hover:text-rose-300"
+                      onClick={() => {
+                        if (!confirm(t('group.removeMemberConfirm'))) return
+                        void run(() => removeGroupMembers(group.id, { userIds: [m.id] }), 'group.memberRemoved', 'group.memberRemoveFailed')
+                      }}
+                    />
+                  )}
+                </div>
+              ))}
+              {members.length === 0 && <p className="py-4 text-center text-sm text-slate-500">{t('group.noMembers')}</p>}
+            </div>
+          </Card>
+        </div>
+      )}
+    </Drawer>
+  )
+}
+
+// ==================================================================
 // Main Page
 // ==================================================================
 
@@ -856,6 +1013,7 @@
   const [groupsError, setGroupsError] = useState<string | null>(null)
   const [groupSearch, setGroupSearch] = useState('')
   const debouncedGroupSearch = useDebounce(groupSearch)
+  const [groupDetail, setGroupDetail] = useState<PermissionGroup | null>(null)
   const [groupModal, setGroupModal] = useState<{ open: boolean; group: PermissionGroup | null }>({ open: false, group: null })
 
   // Invites
@@ -1061,14 +1219,17 @@
       accessor: 'actions',
       cell: (row) => (
         <div className="flex items-center gap-1">
-          <Button variant="ghost" size="sm" icon={Edit} onClick={() => setGroupModal({ open: true, group: row })} />
-          {!row.isSystem && (
+          <Button variant="ghost" size="sm" icon={Users} aria-label={t('group.viewMembers')} onClick={() => setGroupDetail(row)} />
+          {canManage && (
+            <Button variant="ghost" size="sm" icon={Edit} aria-label={t('group.editTitle')} onClick={() => setGroupModal({ open: true, group: row })} />
+          )}
+          {canManage && !row.isSystem && (
             <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDeleteGroup(row.id)} className="text-rose-400 hover:text-rose-300" />
           )}
         </div>
       ),
     },
-  ], [t])
+  ], [t, canManage])
 
   const inviteColumns = useMemo<ColumnDef<TeamInvite>[]>(() => [
     {
@@ -1101,7 +1262,7 @@
       accessor: 'actions',
       cell: (row) => (
         <div className="flex items-center gap-1">
-          {row.status === 'PENDING' && (
+          {canManage && row.status === 'PENDING' && (
             <>
               <Button
                 variant="ghost"
@@ -1123,7 +1284,7 @@
         </div>
       ),
     },
-  ], [t])
+  ], [t, canManage])
 
   // ==================================================================
   // Handlers
@@ -1365,10 +1526,10 @@
               className="lg:w-48"
             >
               <option value="">{t('invite.allStatus')}</option>
-              <option value="PENDING" className="bg-[#0b1224]">{t('inviteStatus.pending')}</option>
-              <option value="ACCEPTED" className="bg-[#0b1224]">{t('inviteStatus.accepted')}</option>
-              <option value="EXPIRED" className="bg-[#0b1224]">{t('inviteStatus.expired')}</option>
-              <option value="REVOKED" className="bg-[#0b1224]">{t('inviteStatus.revoked')}</option>
+              <option value="PENDING" className="bg-[#0b1224]">{t('invite.status.pending')}</option>
+              <option value="ACCEPTED" className="bg-[#0b1224]">{t('invite.status.accepted')}</option>
+              <option value="EXPIRED" className="bg-[#0b1224]">{t('invite.status.expired')}</option>
+              <option value="REVOKED" className="bg-[#0b1224]">{t('invite.status.revoked')}</option>
             </SelectInput>
           </div>
 
@@ -1423,7 +1584,13 @@
         open={!!memberDetail}
         onClose={() => setMemberDetail(null)}
         canManage={canManage}
-        onMemberUpdated={() => { void loadMembers(); setMemberDetail(null) }}
+        onMemberUpdated={() => { void loadMembers(true) }}
+      />
+      <GroupDrawer
+        group={groupDetail}
+        onClose={() => setGroupDetail(null)}
+        canManage={canManage}
+        onChanged={() => { void loadGroups(true); void loadMembers(true) }}
       />
       <GroupModal
         open={groupModal.open}
diff -ruN /tmp/orig/src/pages/servers/GuardAgentPanel.tsx src/pages/servers/GuardAgentPanel.tsx
--- /tmp/orig/src/pages/servers/GuardAgentPanel.tsx	1970-01-01 00:00:00.000000000 +0000
+++ src/pages/servers/GuardAgentPanel.tsx	2026-11-20 08:30:42.829322848 +0000
@@ -0,0 +1,239 @@
+// frontend/src/pages/servers/GuardAgentPanel.tsx
+// Guard-only panel: agent / tunnel state, metrics, enable-tunnel, rotate token, disable agent.
+// Connection state comes ONLY from agent-status (never from dnsVerified).
+
+import { useCallback, useEffect, useRef, useState } from 'react'
+import { useTranslation } from 'react-i18next'
+import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Shield, Wifi, WifiOff } from 'lucide-react'
+import { useToast } from '../../components/ui/Toast'
+import { Badge, Button, KeyValue } from '../../components/ui/kit'
+import {
+  disableAgent,
+  enableTunnel,
+  getAgentStatus,
+  getApiErrorInfo,
+  rotateAgentToken,
+  type AgentStatusSnapshot,
+  type InstallCommandPayload,
+} from '../../services/serversService'
+import { formatDateTime, timeAgo } from '../../utils/format'
+import { CopyButton } from './shared'
+
+type AgentState = 'notInstalled' | 'connected' | 'unstable' | 'disconnected'
+
+/** Token issued / tunnel up / heartbeat fresh are separate facts; this only derives the headline. */
+export function deriveAgentState(s: AgentStatusSnapshot): AgentState {
+  if (!s.hasToken) return 'notInstalled'
+  if (!s.lastAgentAt) return 'disconnected'
+  if (s.tunnelUp && s.isFresh) return 'connected'
+  if (s.tunnelUp && !s.isFresh) return 'unstable'
+  return 'disconnected'
+}
+
+const STATE_TONE = { notInstalled: 'slate', connected: 'emerald', unstable: 'amber', disconnected: 'rose' } as const
+const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`)
+
+interface Props {
+  serverId: string
+  canManage: boolean
+  inMaintenance?: boolean
+}
+
+export function GuardAgentPanel({ serverId, canManage, inMaintenance }: Props) {
+  const { t } = useTranslation('servers')
+  const toast = useToast()
+  const [status, setStatus] = useState<AgentStatusSnapshot | null>(null)
+  const [loading, setLoading] = useState(true)
+  const [error, setError] = useState<string | null>(null)
+  const [busy, setBusy] = useState<'enable' | 'rotate' | 'disable' | null>(null)
+  const [install, setInstall] = useState<InstallCommandPayload | null>(null)
+  const alive = useRef(true)
+
+  const load = useCallback(
+    async (silent = false) => {
+      if (!silent) setLoading(true)
+      try {
+        const data = await getAgentStatus(serverId)
+        if (!alive.current) return
+        setStatus(data)
+        setError(null)
+      } catch (err) {
+        if (!alive.current) return
+        if (!silent) setError(getApiErrorInfo(err).message)
+      } finally {
+        if (alive.current && !silent) setLoading(false)
+      }
+    },
+    [serverId],
+  )
+
+  useEffect(() => {
+    alive.current = true
+    setStatus(null)
+    setInstall(null)
+    void load()
+    const timer = setInterval(() => void load(true), 15000) // keep heartbeat fresh
+    return () => {
+      alive.current = false
+      clearInterval(timer)
+    }
+  }, [load])
+
+  const run = async (kind: 'enable' | 'rotate' | 'disable') => {
+    if (busy || !canManage) return
+    if (kind === 'rotate' && !window.confirm(t('drawer.agent.rotateConfirm'))) return
+    if (kind === 'disable' && !window.confirm(t('drawer.agent.disableConfirm'))) return
+    setBusy(kind)
+    try {
+      if (kind === 'disable') {
+        await disableAgent(serverId, true)
+        setInstall(null)
+        toast.success(t('drawer.agent.disabled'))
+      } else {
+        const res = kind === 'enable' ? await enableTunnel(serverId) : await rotateAgentToken(serverId)
+        setInstall(res.install)
+        toast.success(t(kind === 'enable' ? 'form.toast.tunnelEnabled' : 'drawer.agent.rotated'))
+      }
+      await load(true)
+    } catch (err) {
+      toast.error(t(`drawer.agent.${kind}Failed`), getApiErrorInfo(err).message)
+    } finally {
+      setBusy(null)
+    }
+  }
+
+  if (loading && !status) {
+    return (
+      <div className="flex items-center gap-2 text-sm text-slate-500">
+        <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
+        <span>{t('drawer.fields.guard.loading')}</span>
+      </div>
+    )
+  }
+
+  if (error && !status) {
+    return (
+      <div className="space-y-2">
+        <p className="text-sm text-rose-300">{error}</p>
+        <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => void load()}>
+          {t('drawer.fields.guard.refresh')}
+        </Button>
+      </div>
+    )
+  }
+
+  if (!status) return null
+  const state = deriveAgentState(status)
+
+  return (
+    <div className="space-y-3">
+      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
+        <div className="flex items-start gap-3">
+          {state === 'connected' ? (
+            <Wifi className="mt-0.5 h-5 w-5 text-emerald-400" />
+          ) : (
+            <WifiOff className="mt-0.5 h-5 w-5 text-slate-400" />
+          )}
+          <div>
+            <p className="text-sm font-medium text-white">{t(`drawer.agent.state.${state}`)}</p>
+            <p className="text-xs text-slate-500">{t(`drawer.agent.stateHint.${state}`)}</p>
+          </div>
+        </div>
+        <Badge tone={STATE_TONE[state]} dot>{t(`drawer.agent.state.${state}`)}</Badge>
+      </div>
+
+      {/* Four independent facts */}
+      <div className="flex flex-wrap gap-2">
+        <Badge tone={status.hasToken ? 'cyan' : 'slate'}>
+          {status.hasToken ? t('drawer.agent.tokenIssued') : t('drawer.agent.tokenNotIssued')}
+        </Badge>
+        <Badge tone={status.tunnelUp ? 'emerald' : 'rose'}>
+          {status.tunnelUp ? t('drawer.fields.guard.tunnelUp') : t('drawer.fields.guard.tunnelDown')}
+        </Badge>
+        <Badge tone={status.isFresh ? 'emerald' : 'amber'}>
+          {status.isFresh ? t('drawer.agent.heartbeatFresh') : t('drawer.agent.heartbeatStale')}
+        </Badge>
+      </div>
+
+      {status.hasToken && (
+        <div>
+          <KeyValue label={t('drawer.fields.guard.lastHeartbeat')}>
+            {status.lastAgentAt ? `${timeAgo(status.lastAgentAt)} · ${formatDateTime(status.lastAgentAt)}` : '—'}
+          </KeyValue>
+          <KeyValue label={t('drawer.fields.guard.version')}>{status.agentVersion ?? '—'}</KeyValue>
+          <KeyValue label={t('drawer.agent.os')}>
+            {[status.agentOs, status.agentArch].filter(Boolean).join(' / ') || '—'}
+          </KeyValue>
+          <KeyValue label={t('drawer.agent.peerIp')}>
+            <span dir="ltr">{status.tunnelPeerIp ?? '—'}</span>
+          </KeyValue>
+          <KeyValue label={t('drawer.agent.cpu')}>{pct(status.agentCpuPercent)}</KeyValue>
+          <KeyValue label={t('drawer.agent.ram')}>{pct(status.agentRamPercent)}</KeyValue>
+          <KeyValue label={t('drawer.agent.disk')}>{pct(status.agentDiskPercent)}</KeyValue>
+          <KeyValue label={t('drawer.agent.load')}>{status.agentLoadAvg1m ?? '—'}</KeyValue>
+          <KeyValue label={t('drawer.agent.estimatedMaxRps')}>
+            {status.estimatedMaxRps !== null ? `${status.estimatedMaxRps.toLocaleString('en-US')} req/s` : '—'}
+          </KeyValue>
+          <KeyValue label={t('drawer.agent.originHealth')}>
+            {status.agentOriginOk === null
+              ? '—'
+              : `${status.agentOriginOk ? t('drawer.agent.originOk') : t('drawer.agent.originDown')}${
+                  status.agentOriginLatMs !== null ? ` · ${Math.round(status.agentOriginLatMs)} ms` : ''
+                }`}
+          </KeyValue>
+        </div>
+      )}
+
+      {install && (
+        <div className="space-y-3 rounded-xl border border-cyan-500/25 bg-cyan-500/6 p-4">
+          <p className="flex items-center gap-2 text-sm font-medium text-white">
+            <Shield className="h-4 w-4 text-cyan-400" /> {t('drawer.agent.installTitle')}
+          </p>
+          <div className="flex items-center gap-2">
+            <span className="dir-ltr flex-1 break-all rounded-lg bg-white/5 p-3 font-mono text-xs text-slate-300">
+              {install.command}
+            </span>
+            <CopyButton text={install.command} label={t('form.toast.installCommand')} />
+          </div>
+          <div className="flex gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/6 px-3 py-2">
+            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
+            <p className="text-xs text-rose-200/70">{t('form.toast.tokenOnceWarning')}</p>
+          </div>
+          <p className="text-xs text-slate-400">{t('drawer.agent.runOnServer')}</p>
+          <p className="text-xs text-slate-400">{t('drawer.agent.backToUi')}</p>
+          {install.docsUrl && (
+            <a
+              href={install.docsUrl}
+              target="_blank"
+              rel="noreferrer"
+              className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline"
+            >
+              {t('drawer.agent.docs')} <ExternalLink className="h-3 w-3" />
+            </a>
+          )}
+        </div>
+      )}
+
+      <div className="flex flex-wrap gap-2">
+        <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => void load()}>
+          {t('drawer.fields.guard.refresh')}
+        </Button>
+        {canManage && !status.hasToken && (
+          <Button size="sm" variant="primary" icon={Wifi} loading={busy === 'enable'} disabled={!!busy || inMaintenance} onClick={() => void run('enable')}>
+            {busy === 'enable' ? t('drawer.guard.enabling') : t('drawer.guard.enableTunnel')}
+          </Button>
+        )}
+        {canManage && status.hasToken && (
+          <>
+            <Button size="sm" variant="outline" icon={RefreshCw} loading={busy === 'rotate'} disabled={!!busy} onClick={() => void run('rotate')}>
+              {t('drawer.agent.rotate')}
+            </Button>
+            <Button size="sm" variant="ghost" icon={WifiOff} loading={busy === 'disable'} disabled={!!busy} onClick={() => void run('disable')} className="text-rose-400 hover:text-rose-300">
+              {t('drawer.agent.disable')}
+            </Button>
+          </>
+        )}
+      </div>
+    </div>
+  )
+}
diff -ruN /tmp/orig/src/pages/servers/ServerCard.tsx src/pages/servers/ServerCard.tsx
--- /tmp/orig/src/pages/servers/ServerCard.tsx	2026-11-20 06:38:09.000000000 +0000
+++ src/pages/servers/ServerCard.tsx	2026-11-20 08:37:51.784238268 +0000
@@ -184,7 +184,7 @@
                 {server.domain}
               </p>
               <p dir="ltr" className="truncate text-start font-mono text-xs text-slate-500">
-                {server.originIp}:{server.originPort}
+                {server.setupMode === 'GUARD' ? t('setupMode.GUARD') : `${server.originIp}:${server.originPort}`}
               </p>
             </div>
           </div>
@@ -196,10 +196,14 @@
 
         {/* ---------- Tags ---------- */}
         <div className="mt-3 flex flex-wrap items-center gap-2">
+          <Badge tone={server.setupMode === 'GUARD' ? 'indigo' : 'slate'}>
+            {t(`setupMode.${server.setupMode ?? 'ORIGIN'}`)}
+          </Badge>
           <Badge tone={server.mode === 'PROTECT' ? 'cyan' : 'amber'}>
             {t(`mode.${server.mode}`)}
           </Badge>
 
+          {server.setupMode !== 'GUARD' && (
           <span
             className={cn(
               'inline-flex items-center gap-1 text-xs',
@@ -209,9 +213,11 @@
             {server.sslEnabled ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
             {server.sslEnabled ? t('card.httpsOrigin') : t('card.httpOrigin')}
           </span>
+          )}
         </div>
 
-        {/* ---------- Capacity ---------- */}
+        {/* ---------- Capacity + Health (Origin probe results; Guard has no probe) ---------- */}
+        {server.setupMode !== 'GUARD' && (<>
         <div className="mt-4 rounded-xl border border-white/8 bg-linear-to-br from-cyan-500/5 via-white/2 to-transparent p-4">
           <div className="flex items-center justify-between gap-2">
             <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
@@ -333,6 +339,8 @@
           </div>
         </div>
 
+        </>)}
+
         {/* ---------- Setup checklist (Origin only) ---------- */}
         {server.setupMode !== 'GUARD' && (
           <div className="mt-4 grid grid-cols-3 gap-2">
@@ -357,6 +365,9 @@
             <p className="text-[10px] text-slate-500">
               {server.tunnelUp ? t('card.guard.tunnelActive') : t('card.guard.tunnelInactive')}
             </p>
+            <p className="mt-1 text-[10px] text-slate-500">
+              {t('drawer.fields.guard.lastHeartbeat')}: {server.lastAgentAt ? timeAgo(server.lastAgentAt) : '—'}
+            </p>
           </div>
         )}
 
diff -ruN /tmp/orig/src/pages/servers/ServerDetailDrawer.tsx src/pages/servers/ServerDetailDrawer.tsx
--- /tmp/orig/src/pages/servers/ServerDetailDrawer.tsx	2026-11-20 07:53:01.000000000 +0000
+++ src/pages/servers/ServerDetailDrawer.tsx	2026-11-20 08:31:18.656809661 +0000
@@ -21,10 +21,11 @@
 
 import { useEffect, useRef, useState } from 'react'
 import { useTranslation } from 'react-i18next'
-import { Activity, AlertTriangle, Gauge, Globe, Loader2, Radar, Shield, Timer, Wifi } from 'lucide-react'
+import { Activity, AlertTriangle, Gauge, Globe, Loader2, Radar, Shield, Timer } from 'lucide-react'
 import { useToast } from '../../components/ui/Toast'
 import { Badge, Button, Drawer, KeyValue, Skeleton } from '../../components/ui/kit'
-import { getApiErrorInfo, getServer, getAgentStatus, enableTunnel, requestProbe, type Server } from '../../services/serversService'
+import { getApiErrorInfo, getServer, requestProbe, type Server } from '../../services/serversService'
+import { GuardAgentPanel } from './GuardAgentPanel'
 import { REC_META, formatRps, getConfidenceLabel } from '../../utils/serverMeta'
 import { formatDateTime, formatMs, timeAgo } from '../../utils/format'
 import { cn } from '../../utils/format'
@@ -64,13 +65,6 @@
   const [starting, setStarting] = useState(false)
   const [cooldown, setCooldown] = useState(0)
   const [needsOwnership, setNeedsOwnership] = useState(false)
-  const [agentStatus, setAgentStatus] = useState<{
-    tunnelUp: boolean
-    lastAgentAt: string | null
-    agentVersion: string | null
-  } | null>(null)
-  const [agentLoading, setAgentLoading] = useState(false)
-  const [enablingTunnel, setEnablingTunnel] = useState(false)
 
   // Latest callbacks / values in refs so effects don't re-run (or loop) because of them
   const cb = useRef({ toast, onClose, onServerUpdated, t })
@@ -85,7 +79,6 @@
   const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
 
   const id = server?.id
-  const setupMode = server?.setupMode
   const lastProbeAt = server?.lastProbeAt ?? null
   const updatedAt = server?.updatedAt
 
@@ -102,7 +95,6 @@
     setStarting(false)
     setNeedsOwnership(false)
     setCooldown(0)
-    setAgentStatus(null)
     probeStartedWith.current = null
     clearProbeTimer()
     if (!id) setFull(null)
@@ -142,34 +134,6 @@
     }
   }, [id, lastProbeAt, updatedAt])
 
-  // ---------------- Fetch agent status (for GUARD servers) ----------------
-  useEffect(() => {
-    if (!id || setupMode !== 'GUARD') return
-    let cancelled = false
-    setAgentLoading(true)
-
-    getAgentStatus(id)
-      .then((data) => {
-        if (cancelled) return
-        setAgentStatus({
-          tunnelUp: data.tunnelUp,
-          lastAgentAt: data.lastAgentAt,
-          agentVersion: data.agentVersion,
-        })
-      })
-      .catch(() => {
-        if (cancelled) return
-        // Silently fail - agent status is optional
-      })
-      .finally(() => {
-        if (!cancelled) setAgentLoading(false)
-      })
-
-    return () => {
-      cancelled = true
-    }
-  }, [id, setupMode])
-
   // ---------------- Measurement finished? ----------------
   const fullForId = full && full.id === id ? full : null
   const fullProbeAt = fullForId?.lastProbeAt ?? null
@@ -259,38 +223,6 @@
     }
   }
 
-  const fetchAgentStatus = async () => {
-    if (!id) return
-    setAgentLoading(true)
-    try {
-      const data = await getAgentStatus(id)
-      setAgentStatus({
-        tunnelUp: data.tunnelUp,
-        lastAgentAt: data.lastAgentAt,
-        agentVersion: data.agentVersion,
-      })
-    } catch {
-      // Silently fail
-    } finally {
-      setAgentLoading(false)
-    }
-  }
-
-  const handleEnableTunnel = async () => {
-    if (!id) return
-    setEnablingTunnel(true)
-    try {
-      await enableTunnel(id)
-      toast.success(t('form.toast.tunnelEnabled'), t('form.toast.tunnelEnabledDesc'))
-      await fetchAgentStatus()
-    } catch (err) {
-      const info = getApiErrorInfo(err)
-      toast.error(t('form.toast.tunnelEnableFailed'), info.message)
-    } finally {
-      setEnablingTunnel(false)
-    }
-  }
-
   const rec = s?.probeRecommendation ? REC_META[s.probeRecommendation] : undefined
   const unverified = s ? !s.dnsVerified : false
   const neverMeasured = s ? s.lastProbeAt === null : false
@@ -333,14 +265,7 @@
               {STATUS_META[s.status].label}
             </Badge>
             {s.setupMode === 'GUARD' ? (
-              <>
-                <Badge tone={agentStatus?.tunnelUp ? 'emerald' : 'rose'}>
-                  {agentStatus?.tunnelUp ? t('drawer.fields.guard.tunnelUp') : t('drawer.fields.guard.tunnelDown')}
-                </Badge>
-                <Badge tone={s.tunnelUp ? 'emerald' : 'slate'}>
-                  {s.tunnelUp ? t('drawer.tunnel.active') : t('drawer.tunnel.inactive')}
-                </Badge>
-              </>
+              <Badge tone="cyan">{t('setupMode.GUARD')}</Badge>
             ) : (
               <>
                 <Badge tone={s.dnsVerified ? 'emerald' : 'amber'}>
@@ -353,7 +278,8 @@
             )}
           </div>
 
-          {/* ---------- Safe capacity (primary number) ---------- */}
+          {/* Safe capacity / measurement / origin health are Origin-probe results; Guard has no probe */}
+          {s.setupMode !== 'GUARD' && (<>
           <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-5">
             <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-400/60 to-transparent" />
             <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
@@ -413,54 +339,15 @@
             <KeyValue label={t('drawer.fields.lastCheck')}>{timeAgo(s.lastHealthCheckAt)}</KeyValue>
           </section>
 
+          </>)}
+
           {/* ---------- Guard / Agent Status (for GUARD servers) ---------- */}
           {s.setupMode === 'GUARD' && (
             <section>
               <h4 className={sectionTitle}>
                 <Shield className="me-1.5 inline h-3.5 w-3.5" /> {t('drawer.sections.guard')}
               </h4>
-              {agentLoading ? (
-                <div className="flex items-center gap-2 text-sm text-slate-500">
-                  <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
-                  <span>{t('drawer.fields.guard.loading')}</span>
-                </div>
-              ) : agentStatus ? (
-                <div className="space-y-2">
-                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/3 px-4 py-3">
-                    <div className="flex items-center gap-3">
-                      <div
-                        className={cn(
-                          'h-2.5 w-2.5 rounded-full',
-                          agentStatus.tunnelUp ? 'bg-emerald-400' : 'bg-rose-400',
-                        )}
-                      />
-                      <span className="text-sm font-medium text-white">
-                        {agentStatus.tunnelUp ? t('drawer.fields.guard.tunnelUp') : t('drawer.fields.guard.tunnelDown')}
-                      </span>
-                    </div>
-                    <Badge tone={agentStatus.tunnelUp ? 'emerald' : 'rose'}>
-                      {agentStatus.tunnelUp ? t('drawer.fields.guard.connected') : t('drawer.fields.guard.disconnected')}
-                    </Badge>
-                  </div>
-                  <KeyValue label={t('drawer.fields.guard.lastHeartbeat')}>
-                    {agentStatus.lastAgentAt
-                      ? `${timeAgo(agentStatus.lastAgentAt)} · ${formatDateTime(agentStatus.lastAgentAt)}`
-                      : '—'}
-                  </KeyValue>
-                  <KeyValue label={t('drawer.fields.guard.version')}>
-                    {agentStatus.agentVersion ?? '—'}
-                  </KeyValue>
-                  {canManage && (
-                    <div className="mt-2 flex flex-wrap gap-2">
-                      <Button size="sm" variant="outline" icon={Wifi} onClick={() => void fetchAgentStatus()}>
-                        {t('drawer.fields.guard.refresh')}
-                      </Button>
-                    </div>
-                  )}
-                </div>
-              ) : (
-                <p className="text-sm text-slate-500">{t('drawer.fields.guard.notConfigured')}</p>
-              )}
+              <GuardAgentPanel serverId={s.id} canManage={canManage} inMaintenance={inMaintenance} />
             </section>
           )}
 
@@ -478,31 +365,8 @@
             </div>
           )}
 
-          {canManage ? (
+          {s.setupMode === 'GUARD' ? null : canManage ? (
             <div className="space-y-2">
-              {s.setupMode === 'GUARD' ? (
-                <>
-                  <Button
-                    variant="primary"
-                    className="w-full"
-                    icon={Wifi}
-                    loading={enablingTunnel}
-                    disabled={enablingTunnel || inMaintenance}
-                    onClick={() => void handleEnableTunnel()}
-                  >
-                    {enablingTunnel
-                      ? t('drawer.guard.enabling')
-                      : agentStatus?.tunnelUp || s.tunnelUp
-                        ? t('drawer.guard.tunnelEnabled')
-                        : t('drawer.guard.enableTunnel')}
-                  </Button>
-                  {agentStatus?.tunnelUp && (
-                    <p className="text-center text-xs text-emerald-300/80">
-                      {t('drawer.guard.tunnelActiveHint')}
-                    </p>
-                  )}
-                </>
-              ) : (
                 <>
                   <Button
                     variant="primary"
@@ -526,7 +390,6 @@
                     <p className="text-center text-xs text-slate-500">{t('drawer.maintenanceHint')}</p>
                   )}
                 </>
-              )}
             </div>
           ) : (
             <p className="rounded-xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-500">
diff -ruN /tmp/orig/src/pages/servers/ServerFormModal.tsx src/pages/servers/ServerFormModal.tsx
--- /tmp/orig/src/pages/servers/ServerFormModal.tsx	2026-11-20 07:52:40.000000000 +0000
+++ src/pages/servers/ServerFormModal.tsx	2026-11-20 08:28:26.743111538 +0000
@@ -255,12 +255,22 @@
         toast.success(t('form.toast.added'), t('form.toast.addedDesc'))
 
         if (form.setupMode === 'GUARD') {
-          // Guard flow: enable the tunnel and show the install command instead of the DNS modal
-          const tunnel = await enableTunnel(res.server.id)
-          setInstallCommand(tunnel.install)
-          setShowInstall(true)
+          // Guard flow: the server now exists (setupMode GUARD was sent explicitly).
+          // Enable the tunnel and show ONLY the install command - never the Origin DNS modal.
           onSaved(res.server, undefined)
-          return // keep the modal open: the user needs to copy the command
+          try {
+            const tunnel = await enableTunnel(res.server.id)
+            setInstallCommand(tunnel.install)
+            setShowInstall(true)
+            return // keep the modal open: the user needs to copy the command
+          } catch (tunnelErr) {
+            // Server was created; only tunnel activation failed. Do not report "add failed"
+            // (retrying would create a duplicate) - tell the user to enable it from the details drawer.
+            const info = getApiErrorInfo(tunnelErr)
+            toast.error(t('form.toast.tunnelFailed'), info.message)
+            onClose()
+            return
+          }
         }
 
         onSaved(res.server, res.dns)
diff -ruN /tmp/orig/src/services/serversService.ts src/services/serversService.ts
--- /tmp/orig/src/services/serversService.ts	2026-11-20 07:56:32.000000000 +0000
+++ src/services/serversService.ts	2026-11-20 08:30:00.503626242 +0000
@@ -21,6 +21,7 @@
 // ==================================================================
 
 import api from './api'
+import i18n from '../i18n'
 import { cleanParams } from './types'
 import type { Pagination, ServerMode, ServerStatus, ServerSetupMode } from './types'
 
@@ -250,35 +251,44 @@
  * بدون الاعتماد على نوع مكتبة معينة (axios وغيره).
  */
 export function getApiErrorInfo(error: unknown): ApiErrorInfo {
+  type Body = {
+    code?: string
+    message?: string
+    messageAr?: string
+    details?: { retryAfterSec?: number }
+    errors?: Array<{ field: string; message: string }>
+    // Agent routes wrap the error: { success:false, error:{ code, message, messageAr, details } }
+    error?: { code?: string; message?: string; messageAr?: string; details?: unknown }
+  }
   const err = error as {
-    response?: {
-      status?: number
-      data?: {
-        code?: string
-        message?: string
-        details?: { retryAfterSec?: number }
-        errors?: Array<{ field: string; message: string }>
-      }
-      headers?: Record<string, string | undefined>
-    }
+    response?: { status?: number; data?: Body; headers?: Record<string, string | undefined> }
     message?: string
   }
 
   const res = err?.response
   const body = res?.data
+  const inner = body?.error && typeof body.error === 'object' ? body.error : undefined
+
+  const code = inner?.code ?? body?.code ?? null
+  const rawMessage = inner?.message ?? body?.message
+  const rawMessageAr = inner?.messageAr ?? body?.messageAr
 
   const headerRetry = Number(res?.headers?.['retry-after'])
   const retryAfterSec =
     body?.details?.retryAfterSec ??
     (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : null)
 
-  return {
-    status: res?.status ?? null,
-    code: body?.code ?? null,
-    message: body?.message ?? err?.message ?? 'حدث خطأ غير متوقع',
-    retryAfterSec,
-    fieldErrors: body?.errors ?? [],
-  }
+  // Known setup-mode errors get a dedicated, translated message.
+  const key = code ? `errors.${code}` : null
+  const translated = key && i18n.exists(key, { ns: 'servers' }) ? i18n.t(key, { ns: 'servers' }) : null
+  const isAr = (i18n.language || '').startsWith('ar')
+  const message =
+    translated ??
+    (isAr ? rawMessageAr ?? rawMessage : rawMessage ?? rawMessageAr) ??
+    err?.message ??
+    i18n.t('toast.unexpectedError', { ns: 'servers' })
+
+  return { status: res?.status ?? null, code, message, retryAfterSec, fieldErrors: body?.errors ?? [] }
 }
 
 // ------------------------------------------------------------------
diff -ruN /tmp/orig/src/services/teamService.ts src/services/teamService.ts
--- /tmp/orig/src/services/teamService.ts	2026-11-20 06:27:31.000000000 +0000
+++ src/services/teamService.ts	2026-11-20 08:27:52.242220824 +0000
@@ -94,6 +94,7 @@
   page: number
   limit: number
   total: number
+  totalPages: number
 }
 
 export interface ListResult<T> {
@@ -167,6 +168,48 @@
 }
 
 // ------------------------------------------------------------------
+// Response normalisation (backend contract)
+// Backend list endpoints return a FLAT shape: { items, page, limit, total }.
+// The UI works with { items, pagination: { page, limit, total, totalPages } }.
+// ------------------------------------------------------------------
+
+interface RawList<T> {
+  items?: T[]
+  page?: number
+  limit?: number
+  total?: number
+  pagination?: Partial<Pagination> & { totalPages?: number }
+}
+
+function toListResult<T>(raw: RawList<T> | undefined, fallbackLimit = 20): ListResult<T> {
+  const items = Array.isArray(raw?.items) ? (raw!.items as T[]) : []
+  const p = raw?.pagination
+  const page = p?.page ?? raw?.page ?? 1
+  const limit = p?.limit ?? raw?.limit ?? fallbackLimit
+  const total = p?.total ?? raw?.total ?? items.length
+  return {
+    items,
+    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / Math.max(1, limit))) },
+  }
+}
+
+// Backend getMember spreads the Prisma row, so overrides arrive as `permissionOverrides`
+// (list endpoint uses `overrides`). Map both to the frontend `overrides` field.
+function normalizeMember(raw: any): Member {
+  const overrides = Array.isArray(raw?.overrides)
+    ? raw.overrides
+    : Array.isArray(raw?.permissionOverrides)
+      ? raw.permissionOverrides
+      : []
+  return {
+    ...raw,
+    groups: Array.isArray(raw?.groups) ? raw.groups : [],
+    overrides,
+    permissions: Array.isArray(raw?.permissions) ? raw.permissions : [],
+  } as Member
+}
+
+// ------------------------------------------------------------------
 // Calls
 // ------------------------------------------------------------------
 
@@ -183,10 +226,11 @@
 
 // Groups
 export async function listGroups(query: ListGroupsQuery = {}): Promise<ListResult<PermissionGroup>> {
-  const { data } = await api.get<{ success: boolean; data: ListResult<PermissionGroup> }>('/team/groups', {
+  const { data } = await api.get<{ success: boolean; data: RawList<PermissionGroup> }>('/team/groups', {
     params: cleanParams(query),
   })
-  return data.data
+  const res = toListResult(data.data, query.limit)
+  return { ...res, items: res.items.map((g) => ({ ...g, permissions: Array.isArray(g.permissions) ? g.permissions : [] })) }
 }
 
 export async function getGroup(groupId: string): Promise<PermissionGroup> {
@@ -223,33 +267,26 @@
 
 // Members
 export async function listMembers(query: ListMembersQuery = {}): Promise<ListResult<Member>> {
-  const { data } = await api.get<{ success: boolean; data: ListResult<Member> }>('/team/members', {
+  const { data } = await api.get<{ success: boolean; data: RawList<Member> }>('/team/members', {
     params: cleanParams(query),
   })
-  return data.data
+  const res = toListResult(data.data, query.limit)
+  return { ...res, items: res.items.map(normalizeMember) }
 }
 
 export async function getMember(userId: string): Promise<Member> {
   const { data } = await api.get<{ success: boolean; data: Member }>(`/team/members/${userId}`)
-  const member = data.data
-  // back-end (getMember) returns Prisma relation as `permissionOverrides` but does not
-  // include `overrides` in the response object. Normalise to the frontend contract.
-  return {
-    ...member,
-    groups: Array.isArray(member.groups) ? member.groups : [],
-    overrides: Array.isArray(member.overrides) ? member.overrides : [],
-    permissions: Array.isArray(member.permissions) ? member.permissions : [],
-  }
+  return normalizeMember(data.data)
 }
 
 export async function updateMemberRole(userId: string, input: UpdateMemberRoleInput): Promise<Member> {
   const { data } = await api.patch<{ success: boolean; data: Member }>(`/team/members/${userId}`, input)
-  return data.data
+  return normalizeMember(data.data)
 }
 
 export async function setMemberGroups(userId: string, input: SetMemberGroupsInput): Promise<Member> {
   const { data } = await api.put<{ success: boolean; data: Member }>(`/team/members/${userId}/groups`, input)
-  return data.data
+  return normalizeMember(data.data)
 }
 
 export async function deactivateMember(userId: string): Promise<{ ok: boolean }> {
@@ -270,27 +307,31 @@
 // Overrides
 export async function setUserOverrides(userId: string, input: SetUserOverridesInput): Promise<Member> {
   const { data } = await api.put<{ success: boolean; data: Member }>(`/team/members/${userId}/overrides`, input)
-  return data.data
+  return normalizeMember(data.data)
 }
 
 export async function upsertUserOverride(userId: string, input: UpsertUserOverrideInput): Promise<Member> {
   const { data } = await api.patch<{ success: boolean; data: Member }>(`/team/members/${userId}/overrides`, input)
-  return data.data
+  return normalizeMember(data.data)
 }
 
 export async function deleteUserOverride(userId: string, permission: string): Promise<Member> {
   const { data } = await api.delete<{ success: boolean; data: Member }>(`/team/members/${userId}/overrides`, {
     data: { permission },
   })
-  return data.data
+  return normalizeMember(data.data)
 }
 
 // Invites
 export async function listInvites(query: ListInvitesQuery = {}): Promise<ListResult<TeamInvite>> {
-  const { data } = await api.get<{ success: boolean; data: ListResult<TeamInvite> }>('/team/invites', {
+  const { data } = await api.get<{ success: boolean; data: RawList<TeamInvite> }>('/team/invites', {
     params: cleanParams(query),
   })
-  return data.data
+  const res = toListResult(data.data, query.limit)
+  return {
+    ...res,
+    items: res.items.map((i) => ({ ...i, initialGroupIds: Array.isArray(i.initialGroupIds) ? i.initialGroupIds : [] })),
+  }
 }
 
 export async function createTeamInvite(input: CreateTeamInviteInput): Promise<{
