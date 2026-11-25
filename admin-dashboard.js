/*
 * Fratel-AgriPredict Administrator Dashboard
 * Connects to the existing Supabase schema and protected administrator RPCs.
 * No service-role key is used in this browser application.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    supabase: null,
    user: null,
    profile: null,
    profiles: [],
    roles: [],
    projects: [],
    enrolments: [],
    requests: [],
    farms: [],
    enterprises: [],
    batches: [],
    transactions: [],
    milestones: [],
    progress: [],
    audit: [],
    currentView: 'overview',
    activeProjectId: null
  };

  const viewMeta = {
    overview: ['PLATFORM CONTROL CENTRE', 'Overview'],
    farmers: ['ACCOUNT ADMINISTRATION', 'Farmer accounts'],
    projects: ['PROGRAMME MANAGEMENT', 'Projects & milestones'],
    enrolments: ['FARMER PARTICIPATION', 'Project enrolments'],
    requests: ['ADMINISTRATOR REVIEW', 'Project exit requests'],
    progress: ['PROJECT DELIVERY', 'Farmer project progress'],
    operations: ['WHOLE-FARM MONITORING', 'Farm operations'],
    audit: ['ACCOUNTABILITY', 'Administrator audit trail']
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function showNotice(message, type = 'success') {
    const node = $('notice');
    node.textContent = message;
    node.className = `notice visible ${type}`;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => {
      node.className = 'notice';
      node.textContent = '';
    }, 7000);
  }

  function toast(message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast${type === 'error' ? ' error' : ''}`;
    node.textContent = message;
    $('toastRegion').appendChild(node);
    window.setTimeout(() => node.remove(), 4500);
  }

  function fail(error, fallback = 'The operation could not be completed.') {
    console.error('[AgriPredict admin]', error);
    const message = error?.message || fallback;
    toast(message, 'error');
  }

  function dateLabel(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  function dateTimeLabel(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function currency(value, unit = 'UGX') {
    const number = Number(value || 0);
    return `${unit} ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number)}`;
  }

  function initials(name) {
    return String(name || 'F').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  }

  function slugify(value) {
    return String(value || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function statusPill(status) {
    const clean = String(status || 'unknown').toLowerCase();
    return `<span class="pill ${escapeHtml(clean)}">${escapeHtml(clean.replaceAll('_', ' '))}</span>`;
  }

  function openView(name) {
    if (!viewMeta[name]) return;
    state.currentView = name;
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === `view-${name}`));
    document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === name));
    $('sectionEyebrow').textContent = viewMeta[name][0];
    $('sectionTitle').textContent = viewMeta[name][1];
    state.currentView = name;
    $('adminSidebar').classList.remove('open');
    $('mobileBackdrop')?.classList.remove('show');
  }

  async function readTable(table, columns = '*', orderColumn = null, ascending = false) {
    let query = state.supabase.from(table).select(columns);
    if (orderColumn) query = query.order(orderColumn, { ascending });
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  }

  async function checkAdministrator() {
    const { data: sessionResult, error: sessionError } = await state.supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const session = sessionResult?.session;
    if (!session) {
      window.location.replace(new URL('auth.html', window.location.href).toString());
      return false;
    }
    state.user = session.user;

    const [{ data: profile, error: profileError }, { data: securedRole, error: roleError }] = await Promise.all([
      state.supabase.from('profiles').select('id, full_name, email, role, account_status').eq('id', state.user.id).maybeSingle(),
      state.supabase.from('user_roles').select('user_id, role').eq('user_id', state.user.id).maybeSingle()
    ]);
    if (profileError) throw profileError;
    if (roleError) throw roleError;

    if (!profile || profile.role !== 'admin' || securedRole?.role !== 'admin' || profile.account_status !== 'active') {
      await state.supabase.auth.signOut();
      window.location.replace(new URL('auth.html', window.location.href).toString());
      return false;
    }

    state.profile = profile;
    const name = profile.full_name || 'Administrator';
    $('adminName').textContent = name;
    $('welcomeAdminName').textContent = name.split(' ')[0];
    $('adminAvatar').textContent = initials(name);
    $('todayLabel').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
    $('footerYear').textContent = new Date().getFullYear();
    $('connectionLabel').textContent = 'Secure database session';
    $('connectionLabel').parentElement.classList.add('connected');
    return true;
  }

  async function loadData() {
    $('connectionLabel').textContent = 'Refreshing records';
    $('connectionLabel').parentElement.classList.remove('connected', 'error');
    const tasks = await Promise.all([
      readTable('profiles', 'id,full_name,username,email,phone,role,account_status,created_at', 'created_at'),
      readTable('user_roles', 'user_id,role'),
      readTable('projects', '*', 'name', true),
      readTable('project_enrollments', '*', 'enrolled_at'),
      readTable('project_unenrollment_requests', '*', 'requested_at'),
      readTable('farms', 'id,farmer_id,name,district,created_at', 'created_at'),
      readTable('farm_enterprises', 'id,farm_id,project_id,project_enrollment_id,enterprise_type,name,status,start_date', 'created_at'),
      readTable('livestock_batches', 'id,enterprise_id,batch_name,species,status,opening_quantity,start_date', 'start_date'),
      readTable('farm_transactions', 'id,farm_id,transaction_type,amount,currency,transaction_date,description', 'transaction_date'),
      readTable('project_milestones', '*', 'sequence_no', true),
      readTable('farmer_project_progress', '*', 'updated_at'),
      readTable('admin_audit_logs', '*', 'occurred_at')
    ]);
    [state.profiles, state.roles, state.projects, state.enrolments, state.requests, state.farms,
      state.enterprises, state.batches, state.transactions, state.milestones, state.progress, state.audit] = tasks;
    $('connectionLabel').textContent = 'Secure database session';
    $('connectionLabel').parentElement.classList.add('connected');
    renderAll();
  }

  function renderAll() {
    renderOverview();
    renderFarmers();
    renderProjects();
    renderEnrolments();
    renderRequests();
    renderProgress();
    renderOperations();
    renderAudit();
  }

  function farmersOnly() {
    return state.profiles.filter(profile => (profile.role || 'farmer') === 'farmer');
  }

  function renderOverview() {
    const farmers = farmersOnly();
    const activeFarmers = farmers.filter(profile => profile.account_status === 'active');
    const activeProjects = state.projects.filter(project => project.is_active);
    const pending = state.requests.filter(request => request.status === 'pending');
    $('metricFarmers').textContent = farmers.length;
    $('metricFarmersSub').textContent = `${state.profiles.length - farmers.length} administrator account(s)`;
    $('metricActiveFarmers').textContent = activeFarmers.length;
    $('metricProjects').textContent = activeProjects.length;
    $('metricProjectsSub').textContent = `${state.projects.length} total projects`;
    $('metricRequests').textContent = pending.length;
    $('requestNavCount').textContent = pending.length;
    $('requestNavCount').hidden = pending.length === 0;
    $('metricFarms').textContent = state.farms.length;
    $('metricEnterprises').textContent = state.enterprises.filter(item => item.status === 'active').length;
    $('metricBatches').textContent = state.batches.filter(item => item.status === 'active').length;
    const opening = state.batches.reduce((sum, item) => sum + Number(item.opening_quantity || 0), 0);
    $('metricOpeningStock').textContent = new Intl.NumberFormat().format(opening);

    const recent = [...farmers].sort((a,b) => new Date(b.created_at || 0)-new Date(a.created_at || 0)).slice(0,5);
    $('recentFarmers').innerHTML = recent.length ? recent.map(profile => `
      <div class="compact-row"><div class="mini-avatar">${escapeHtml(initials(profile.full_name))}</div><div class="compact-main"><strong>${escapeHtml(profile.full_name || 'Farmer')}</strong><small>${escapeHtml(profile.email || profile.username || 'No contact email')}</small></div><span class="compact-meta">${escapeHtml(dateLabel(profile.created_at))}</span></div>`).join('') : '<div class="empty-copy">No farmer accounts found.</div>';

    $('overviewRequests').innerHTML = pending.length ? [...pending].sort((a,b)=>new Date(b.requested_at)-new Date(a.requested_at)).slice(0,4).map(request => {
      const person = state.profiles.find(item => item.id === request.farmer_id);
      const enrolment = state.enrolments.find(item => item.id === request.enrollment_id);
      const project = state.projects.find(item => item.id === enrolment?.project_id);
      return `<div class="compact-row"><div class="mini-avatar">↗</div><div class="compact-main"><strong>${escapeHtml(person?.full_name || 'Farmer')}</strong><small>${escapeHtml(project?.name || 'Project enrolment')}</small></div><span class="pill pending">Pending</span></div>`;
    }).join('') : '<div class="empty-copy">No exit requests are waiting for review.</div>';
  }

  function renderFarmers() {
    const query = ($('farmerSearch').value || '').toLowerCase().trim();
    const status = $('farmerStatusFilter').value;
    const entries = farmersOnly().filter(profile => {
      const match = [profile.full_name, profile.username, profile.email, profile.phone].some(value => String(value || '').toLowerCase().includes(query));
      return match && (status === 'all' || profile.account_status === status);
    });
    $('farmerCount').textContent = `${entries.length} account${entries.length === 1 ? '' : 's'}`;
    $('farmersTable').innerHTML = entries.length ? entries.map(profile => {
      const admin = profile.role === 'admin' || state.roles.some(role => role.user_id === profile.id);
      const self = profile.id === state.user.id;
      return `<tr>
        <td><div class="farmer-cell"><div class="mini-avatar">${escapeHtml(initials(profile.full_name))}</div><div><strong>${escapeHtml(profile.full_name || 'Farmer')}</strong><small>@${escapeHtml(profile.username || 'username not set')}</small></div></div></td>
        <td class="contact-cell">${escapeHtml(profile.email || 'No email')}<small>${escapeHtml(profile.phone || 'No phone')}</small></td>
        <td>${statusPill(admin ? 'admin' : 'farmer')}</td>
        <td>${statusPill(profile.account_status || 'active')}</td>
        <td>${escapeHtml(dateLabel(profile.created_at))}</td>
        <td><div class="row-actions"><button class="small-button" data-action="edit-farmer" data-id="${escapeHtml(profile.id)}">Edit</button>${!admin ? `<button class="small-button" data-action="farmer-status" data-id="${escapeHtml(profile.id)}" data-status="${profile.account_status === 'suspended' ? 'active' : 'suspended'}">${profile.account_status === 'suspended' ? 'Activate' : 'Suspend'}</button><button class="small-button" data-action="farmer-role" data-id="${escapeHtml(profile.id)}" data-role="admin">Make admin</button>` : (!self ? `<button class="small-button" data-action="farmer-role" data-id="${escapeHtml(profile.id)}" data-role="farmer">Make farmer</button>` : '<span class="compact-meta">You</span>')}</div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="table-empty">No farmer accounts match this filter.</td></tr>';
  }

  function renderProjects() {
    const query = ($('projectSearch').value || '').toLowerCase().trim();
    const filter = $('projectStatusFilter').value;
    const entries = state.projects.filter(project => {
      const matches = [project.name, project.slug, project.category].some(value => String(value || '').toLowerCase().includes(query));
      return matches && (filter === 'all' || (filter === 'active' ? project.is_active : !project.is_active));
    });
    $('projectCount').textContent = `${entries.length} project${entries.length === 1 ? '' : 's'}`;
    $('projectsTable').innerHTML = entries.length ? entries.map(project => {
      const enrollmentCount = state.enrolments.filter(item => item.project_id === project.id && item.status === 'active').length;
      const milestoneCount = state.milestones.filter(item => item.project_id === project.id).length;
      return `<tr><td><div class="farmer-cell"><div class="mini-avatar">▣</div><div><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.slug)}</small></div></div></td><td>${escapeHtml(project.category || 'General')}</td><td>${enrollmentCount}</td><td>${milestoneCount}</td><td>${statusPill(project.is_active ? 'active' : 'inactive')}</td><td><div class="row-actions"><button class="small-button" data-action="edit-project" data-id="${escapeHtml(project.id)}">Edit</button><button class="small-button" data-action="milestones" data-id="${escapeHtml(project.id)}">Milestones</button><button class="small-button" data-action="project-status" data-id="${escapeHtml(project.id)}" data-status="${project.is_active ? 'false' : 'true'}">${project.is_active ? 'Deactivate' : 'Activate'}</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="table-empty">No projects match this filter.</td></tr>';
  }

  function renderEnrolments() {
    const query = ($('enrolmentSearch').value || '').toLowerCase().trim();
    const filter = $('enrolmentStatusFilter').value;
    const entries = state.enrolments.filter(enrolment => {
      const person = state.profiles.find(item => item.id === enrolment.farmer_id);
      const project = state.projects.find(item => item.id === enrolment.project_id);
      const matches = [person?.full_name, person?.email, project?.name].some(value => String(value || '').toLowerCase().includes(query));
      return matches && (filter === 'all' || (enrolment.status || 'active') === filter);
    });
    $('enrolmentCount').textContent = `${entries.length} enrolment${entries.length === 1 ? '' : 's'}`;
    $('enrolmentsTable').innerHTML = entries.length ? entries.map(item => {
      const person = state.profiles.find(profile => profile.id === item.farmer_id);
      const project = state.projects.find(entry => entry.id === item.project_id);
      return `<tr><td><div class="farmer-cell"><div class="mini-avatar">${escapeHtml(initials(person?.full_name))}</div><div><strong>${escapeHtml(person?.full_name || 'Unknown farmer')}</strong><small>${escapeHtml(person?.email || '')}</small></div></div></td><td>${escapeHtml(project?.name || 'Project no longer listed')}</td><td>${escapeHtml(dateLabel(item.enrolled_at))}</td><td>${statusPill(item.status || 'active')}</td><td>${escapeHtml(dateLabel(item.unenrolled_at))}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="table-empty">No enrolments match this filter.</td></tr>';
  }

  function renderRequests() {
    const filter = $('requestStatusFilter').value;
    const entries = [...state.requests].filter(item => filter === 'all' || item.status === filter).sort((a,b)=>new Date(b.requested_at)-new Date(a.requested_at));
    $('requestCount').textContent = `${entries.length} request${entries.length === 1 ? '' : 's'}`;
    $('requestsList').innerHTML = entries.length ? entries.map(request => {
      const person = state.profiles.find(item => item.id === request.farmer_id);
      const enrolment = state.enrolments.find(item => item.id === request.enrollment_id);
      const project = state.projects.find(item => item.id === enrolment?.project_id);
      const pending = request.status === 'pending';
      return `<article class="request-card"><div class="request-top"><div class="request-person"><div class="mini-avatar">${escapeHtml(initials(person?.full_name))}</div><div><strong>${escapeHtml(person?.full_name || 'Unknown farmer')}</strong><small>${escapeHtml(project?.name || 'Project')} · ${escapeHtml(person?.email || '')}</small></div></div>${statusPill(request.status)}</div><div class="request-reason">${escapeHtml(request.reason)}</div><div class="request-bottom"><span class="request-date">Submitted ${escapeHtml(dateTimeLabel(request.requested_at))}${request.reviewed_at ? ` · Reviewed ${escapeHtml(dateTimeLabel(request.reviewed_at))}` : ''}</span>${pending ? `<button class="primary-button" data-action="review-request" data-id="${escapeHtml(request.id)}">Review request</button>` : `<span class="compact-meta">${escapeHtml(request.admin_response || 'No administrator response recorded')}</span>`}</div></article>`;
    }).join('') : '<div class="panel empty-copy">No requests found for this status.</div>';
  }

  function renderProgress() {
    const query = ($('progressSearch').value || '').toLowerCase().trim();
    const filter = $('progressStatusFilter').value;
    const entries = state.progress.filter(item => {
      const person = state.profiles.find(profile => profile.id === item.farmer_id);
      const enrolment = state.enrolments.find(row => row.id === item.enrollment_id);
      const project = state.projects.find(row => row.id === enrolment?.project_id);
      const milestone = state.milestones.find(row => row.id === item.milestone_id);
      const matches = [person?.full_name, project?.name, milestone?.title].some(value => String(value || '').toLowerCase().includes(query));
      return matches && (filter === 'all' || item.status === filter);
    });
    $('progressCount').textContent = `${entries.length} update${entries.length === 1 ? '' : 's'}`;
    $('progressTable').innerHTML = entries.length ? entries.map(item => {
      const person = state.profiles.find(profile => profile.id === item.farmer_id);
      const enrolment = state.enrolments.find(row => row.id === item.enrollment_id);
      const project = state.projects.find(row => row.id === enrolment?.project_id);
      const milestone = state.milestones.find(row => row.id === item.milestone_id);
      const percent = Math.max(0, Math.min(100, Number(item.progress_percent || 0)));
      return `<tr><td><strong>${escapeHtml(person?.full_name || 'Farmer')}</strong><small class="compact-meta">${escapeHtml(project?.name || 'Project')}</small></td><td>${escapeHtml(milestone?.title || 'Milestone')}</td><td class="progress-cell"><strong>${percent.toFixed(0)}%</strong><div class="progress-track"><span style="width:${percent}%"></span></div></td><td>${statusPill(item.status)}</td><td>${escapeHtml(dateLabel(item.updated_at))}</td><td><div class="row-actions"><button class="small-button" data-action="edit-progress" data-id="${escapeHtml(item.id)}">Review</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="table-empty">No project progress records match this filter.</td></tr>';
  }

  function renderOperations() {
    const activeEnterprises = state.enterprises.filter(item => item.status === 'active').length;
    const activeBatches = state.batches.filter(item => item.status === 'active').length;
    const expenses = state.transactions.filter(item => item.transaction_type === 'expense').reduce((sum,item)=>sum+Number(item.amount||0),0);
    const income = state.transactions.filter(item => item.transaction_type === 'income').reduce((sum,item)=>sum+Number(item.amount||0),0);
    const net = income - expenses;
    $('reportFarms').textContent = state.farms.length;
    $('reportEnterprises').textContent = state.enterprises.length;
    $('reportActiveEnterprises').textContent = `${activeEnterprises} active`;
    $('reportBatches').textContent = state.batches.length;
    $('reportActiveBatches').textContent = `${activeBatches} active`;
    $('reportExpenses').textContent = currency(expenses);
    $('reportIncome').textContent = currency(income);
    $('reportNet').textContent = currency(net);
    const latest = [...state.transactions].sort((a,b)=>new Date(b.transaction_date)-new Date(a.transaction_date)).slice(0,30);
    $('transactionsTable').innerHTML = latest.length ? latest.map(item => {
      const farm = state.farms.find(row => row.id === item.farm_id);
      const sign = item.transaction_type === 'income' ? '+' : '−';
      return `<tr><td>${escapeHtml(dateLabel(item.transaction_date))}</td><td>${escapeHtml(item.description || 'Farm transaction')}</td><td>${statusPill(item.transaction_type)}</td><td>${escapeHtml(farm?.name || 'Farm')}</td><td class="align-right"><strong>${sign}${escapeHtml(currency(item.amount,item.currency || 'UGX'))}</strong></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="table-empty">No financial transactions have been recorded.</td></tr>';
  }

  function renderAudit() {
    const entries = state.audit.slice(0,150);
    $('auditTable').innerHTML = entries.length ? entries.map(item => {
      const actor = state.profiles.find(profile => profile.id === item.actor_id);
      const payload = item.new_data || item.old_data || {};
      const summary = payload.name || payload.full_name || payload.title || payload.status || payload.action || '';
      return `<tr><td>${escapeHtml(dateTimeLabel(item.occurred_at))}</td><td>${escapeHtml(actor?.full_name || 'System / unknown')}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.table_name)}</td><td><small>${escapeHtml(item.record_id || '—')}</small></td><td>${escapeHtml(summary || 'Record updated')}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="table-empty">No administrator audit entries are available.</td></tr>';
  }

  function openModal(title, kind, fields) {
    $('modalTitle').textContent = title;
    $('modalFields').innerHTML = fields;
    $('editorForm').dataset.form = kind;
    $('editorDialog').showModal();
  }

  function closeModal() {
    if ($('editorDialog').open) $('editorDialog').close();
    $('editorForm').reset();
    $('editorForm').dataset.form = '';
    $('modalFields').innerHTML = '';
  }

  function farmerEdit(profile) {
    openModal('Edit farmer profile', 'farmer', `
      <input type="hidden" name="id" value="${escapeHtml(profile.id)}">
      <div class="field"><label>Full name</label><input name="full_name" required maxlength="120" value="${escapeHtml(profile.full_name)}"></div>
      <div class="field-grid"><div class="field"><label>Username</label><input name="username" maxlength="40" value="${escapeHtml(profile.username)}"></div><div class="field"><label>Phone</label><input name="phone" maxlength="40" value="${escapeHtml(profile.phone)}"></div></div>
      <div class="field"><label>Email (display only)</label><input value="${escapeHtml(profile.email)}" disabled><span class="field-help">Changing the login email must be handled through Supabase Authentication, not this profile editor.</span></div>`);
  }

  function projectEditor(project = null) {
    const features = Array.isArray(project?.features) ? project.features.join('\n') : (project?.features ? JSON.stringify(project.features, null, 2) : '');
    openModal(project ? 'Edit project' : 'Create project', 'project', `
      <input type="hidden" name="id" value="${escapeHtml(project?.id || '')}">
      <div class="field-grid"><div class="field"><label>Project name</label><input name="name" required maxlength="120" value="${escapeHtml(project?.name || '')}" placeholder="e.g. Broiler Farming"></div><div class="field"><label>URL slug</label><input name="slug" required maxlength="100" value="${escapeHtml(project?.slug || '')}" placeholder="broiler-farming"><span class="field-help">Unique, lowercase identifier.</span></div></div>
      <div class="field"><label>Category</label><input name="category" maxlength="80" value="${escapeHtml(project?.category || '')}" placeholder="Poultry, livestock, crops…"></div>
      <div class="field"><label>Description</label><textarea name="description" rows="3" placeholder="Describe this agricultural project">${escapeHtml(project?.description || '')}</textarea></div>
      <div class="field"><label>Project image URL</label><input name="image_url" type="url" value="${escapeHtml(project?.image_url || '')}" placeholder="https://…"><span class="field-help">Optional. Use an image hosted at a public URL.</span></div>
      <div class="field"><label>Features (one per line)</label><textarea name="features" rows="3">${escapeHtml(features)}</textarea></div>
      <label class="check-field"><input name="is_active" type="checkbox" ${project?.is_active === false ? '' : 'checked'}> Make this project available for farmer enrolment</label>`);
  }

  function enrolmentEditor() {
    const activeFarmers = farmersOnly().filter(profile => profile.account_status === 'active');
    const activeProjects = state.projects.filter(project => project.is_active);
    if (!activeFarmers.length || !activeProjects.length) {
      toast('You need at least one active farmer and one active project before adding an enrolment.', 'error');
      return;
    }
    openModal('Add project enrolment', 'enrolment', `
      <div class="field"><label>Farmer account</label><select name="farmer_id" required><option value="">Select farmer</option>${activeFarmers.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.full_name || person.email || person.id)}${person.email ? ` — ${escapeHtml(person.email)}` : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Active project</label><select name="project_id" required><option value="">Select project</option>${activeProjects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Enrolment date</label><input name="enrolled_at" type="date" required value="${new Date().toISOString().slice(0,10)}"></div>
      <p class="field-help">An active enrolment is linked to the farmer's existing farm. Existing active duplicates are blocked by the database.</p>`);
  }

  function requestReviewEditor(request) {
    const person = state.profiles.find(item => item.id === request.farmer_id);
    const enrolment = state.enrolments.find(item => item.id === request.enrollment_id);
    const project = state.projects.find(item => item.id === enrolment?.project_id);
    openModal('Review project exit request', 'request', `
      <input type="hidden" name="id" value="${escapeHtml(request.id)}">
      <div class="field"><label>Farmer and project</label><input disabled value="${escapeHtml(person?.full_name || 'Farmer')} — ${escapeHtml(project?.name || 'Project')}"></div>
      <div class="field"><label>Farmer's reason</label><textarea disabled rows="3">${escapeHtml(request.reason)}</textarea></div>
      <div class="field"><label>Decision</label><select name="decision" required><option value="approved">Approve exit request</option><option value="declined">Decline exit request</option></select></div>
      <div class="field"><label>Administrator response</label><textarea name="admin_response" rows="3" placeholder="Explain the decision to the farmer…"></textarea><span class="field-help">A short explanation is recommended for both decisions.</span></div>`);
  }

  function progressEditor(progress) {
    const person = state.profiles.find(item => item.id === progress.farmer_id);
    const milestone = state.milestones.find(item => item.id === progress.milestone_id);
    openModal('Review farmer progress', 'progress', `
      <input type="hidden" name="id" value="${escapeHtml(progress.id)}">
      <div class="field"><label>Farmer / milestone</label><input disabled value="${escapeHtml(person?.full_name || 'Farmer')} — ${escapeHtml(milestone?.title || 'Milestone')}"></div>
      <div class="field-grid"><div class="field"><label>Status</label><select name="status"><option value="not_started" ${progress.status === 'not_started' ? 'selected' : ''}>Not started</option><option value="in_progress" ${progress.status === 'in_progress' ? 'selected' : ''}>In progress</option><option value="completed" ${progress.status === 'completed' ? 'selected' : ''}>Completed</option><option value="blocked" ${progress.status === 'blocked' ? 'selected' : ''}>Blocked</option></select></div><div class="field"><label>Progress (%)</label><input name="progress_percent" type="number" min="0" max="100" step="1" required value="${escapeHtml(progress.progress_percent ?? 0)}"></div></div>
      <div class="field"><label>Farmer's notes</label><textarea disabled rows="2">${escapeHtml(progress.farmer_notes || '')}</textarea></div>
      <div class="field"><label>Administrator feedback</label><textarea name="admin_notes" rows="3" placeholder="Feedback, actions required or next steps…">${escapeHtml(progress.admin_notes || '')}</textarea></div>`);
  }

  function milestonesEditor(project) {
    state.activeProjectId = project.id;
    const milestones = state.milestones.filter(item => item.project_id === project.id).sort((a,b)=>a.sequence_no-b.sequence_no);
    openModal(`Milestones · ${project.name}`, 'milestone', `
      <div class="milestone-list">${milestones.length ? milestones.map(item => `<div class="compact-row"><div class="mini-avatar">${escapeHtml(item.sequence_no)}</div><div class="compact-main"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description || 'No description')} · ${item.due_after_days == null ? 'No due-day target' : `${item.due_after_days} days`}</small></div>${statusPill(item.is_active ? 'active' : 'inactive')}<button class="small-button" type="button" data-action="milestone-status" data-id="${escapeHtml(item.id)}" data-status="${item.is_active ? 'false' : 'true'}">${item.is_active ? 'Disable' : 'Enable'}</button></div>`).join('') : '<div class="empty-copy">No milestones have been created for this project.</div>'}</div>
      <div class="field-grid"><div class="field"><label>Milestone title</label><input name="title" maxlength="140" required placeholder="e.g. Complete farm setup"></div><div class="field"><label>Target day after enrolment</label><input name="due_after_days" type="number" min="0" placeholder="Optional"></div></div>
      <div class="field"><label>Description</label><textarea name="description" rows="2" placeholder="What should the farmer complete?"></textarea></div>
      <label class="check-field"><input name="is_required" type="checkbox" checked> Required milestone</label>
      <input type="hidden" name="project_id" value="${escapeHtml(project.id)}">
      <p class="field-help">The next sequence number is assigned automatically. Existing milestones are retained; disabling one does not delete its history.</p>`);
  }

  async function runAction(label, operation) {
    try {
      const { error } = await operation();
      if (error) throw error;
      closeModal();
      toast(label);
      await loadData();
    } catch (error) { fail(error); }
  }

  async function submitModal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const kind = form.dataset.form;
    const data = Object.fromEntries(new FormData(form).entries());

    if (kind === 'farmer') {
      const { id, full_name, username, phone } = data;
      await runAction('Farmer profile updated.', () => state.supabase.from('profiles').update({
        full_name: full_name.trim(), username: username.trim() || null, phone: phone.trim() || null
      }).eq('id', id));
    } else if (kind === 'project') {
      const featuresText = (data.features || '').trim();
      let features = [];
      if (featuresText) {
        try {
          const parsed = JSON.parse(featuresText);
          features = Array.isArray(parsed) ? parsed : [parsed];
        } catch (_) {
          features = featuresText.split('\n').map(value => value.trim()).filter(Boolean);
        }
      }
      const payload = {
        name: data.name.trim(), slug: slugify(data.slug || data.name),
        category: data.category.trim() || null, description: data.description.trim() || null,
        image_url: data.image_url.trim() || null, features,
        is_active: form.querySelector('[name="is_active"]').checked
      };
      const result = data.id
        ? await state.supabase.from('projects').update(payload).eq('id', data.id)
        : await state.supabase.from('projects').insert(payload);
      await runAction(data.id ? 'Project updated.' : 'Project created.', () => Promise.resolve(result));
    } else if (kind === 'enrolment') {
      const payload = { farmer_id: data.farmer_id, project_id: data.project_id, enrolled_at: new Date(`${data.enrolled_at}T12:00:00`).toISOString(), status: 'active' };
      await runAction('Project enrolment created.', () => state.supabase.from('project_enrollments').insert(payload));
    } else if (kind === 'request') {
      await runAction('Exit request reviewed.', () => state.supabase.rpc('admin_review_unenrollment', {
        p_request_id: data.id, p_decision: data.decision, p_admin_response: data.admin_response || null
      }));
    } else if (kind === 'progress') {
      await runAction('Project progress review saved.', () => state.supabase.from('farmer_project_progress').update({
        status: data.status, progress_percent: Number(data.progress_percent), admin_notes: data.admin_notes.trim() || null,
        reviewed_by: state.user.id, reviewed_at: new Date().toISOString()
      }).eq('id', data.id));
    } else if (kind === 'milestone') {
      const related = state.milestones.filter(item => item.project_id === data.project_id);
      const sequence = related.reduce((max,item)=>Math.max(max,Number(item.sequence_no||0)),0) + 1;
      const payload = {
        project_id: data.project_id, title: data.title.trim(), description: data.description.trim() || null,
        sequence_no: sequence, due_after_days: data.due_after_days === '' ? null : Number(data.due_after_days),
        is_required: form.querySelector('[name="is_required"]').checked, is_active: true, created_by: state.user.id
      };
      await runAction('Project milestone added.', () => state.supabase.from('project_milestones').insert(payload));
    }
  }

  async function clickAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'edit-farmer') {
      const profile = state.profiles.find(item => item.id === id);
      if (profile) farmerEdit(profile);
    } else if (action === 'farmer-status') {
      const status = button.dataset.status;
      const person = state.profiles.find(item => item.id === id);
      if (!person || !window.confirm(`${status === 'suspended' ? 'Suspend' : 'Activate'} ${person.full_name || 'this farmer'}'s account?`)) return;
      try {
        const { error } = await state.supabase.rpc('admin_set_farmer_status', { p_user_id: id, p_status: status });
        if (error) throw error;
        toast(`Farmer account ${status}.`);
        await loadData();
      } catch (error) { fail(error); }
    } else if (action === 'farmer-role') {
      const role = button.dataset.role;
      const person = state.profiles.find(item => item.id === id);
      if (!person || !window.confirm(`Change ${person.full_name || 'this account'} to ${role}?`)) return;
      try {
        const { error } = await state.supabase.rpc('admin_set_user_role', { p_user_id: id, p_role: role });
        if (error) throw error;
        toast(`Account role changed to ${role}.`);
        await loadData();
      } catch (error) { fail(error); }
    } else if (action === 'edit-project') {
      const project = state.projects.find(item => item.id === id);
      if (project) projectEditor(project);
    } else if (action === 'project-status') {
      const project = state.projects.find(item => item.id === id);
      const active = button.dataset.status === 'true';
      if (!project || !window.confirm(`${active ? 'Activate' : 'Deactivate'} ${project.name}?`)) return;
      try {
        const { error } = await state.supabase.from('projects').update({ is_active: active }).eq('id', id);
        if (error) throw error;
        toast(`Project ${active ? 'activated' : 'deactivated'}.`);
        await loadData();
      } catch (error) { fail(error); }
    } else if (action === 'milestones') {
      const project = state.projects.find(item => item.id === id);
      if (project) milestonesEditor(project);
    } else if (action === 'milestone-status') {
      const active = button.dataset.status === 'true';
      try {
        const { error } = await state.supabase.from('project_milestones').update({ is_active: active }).eq('id', id);
        if (error) throw error;
        toast(`Milestone ${active ? 'enabled' : 'disabled'}.`);
        await loadData();
        const project = state.projects.find(item => item.id === state.activeProjectId);
        if (project) milestonesEditor(project);
      } catch (error) { fail(error); }
    } else if (action === 'review-request') {
      const request = state.requests.find(item => item.id === id);
      if (request) requestReviewEditor(request);
    } else if (action === 'edit-progress') {
      const progress = state.progress.find(item => item.id === id);
      if (progress) progressEditor(progress);
    }
  }

  function bindEvents() {
    document.querySelectorAll('.nav-link').forEach(button => button.addEventListener('click', () => openView(button.dataset.view)));
    document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => openView(button.dataset.go)));
    $('mobileMenu').addEventListener('click', () => $('adminSidebar').classList.toggle('open'));
    $('refreshButton').addEventListener('click', async () => {
      try { await loadData(); toast('Dashboard data refreshed.'); }
      catch (error) { $('connectionLabel').textContent = 'Data refresh failed'; $('connectionLabel').parentElement.classList.add('error'); fail(error); }
    });
    $('signOutButton').addEventListener('click', async () => {
      if (!window.confirm('Sign out of the administrator dashboard?')) return;
      await state.supabase.auth.signOut();
      window.location.replace(new URL('auth.html', window.location.href).toString());
    });
    $('farmerSearch').addEventListener('input', renderFarmers);
    $('farmerStatusFilter').addEventListener('change', renderFarmers);
    $('projectSearch').addEventListener('input', renderProjects);
    $('projectStatusFilter').addEventListener('change', renderProjects);
    $('enrolmentSearch').addEventListener('input', renderEnrolments);
    $('enrolmentStatusFilter').addEventListener('change', renderEnrolments);
    $('requestStatusFilter').addEventListener('change', renderRequests);
    $('progressSearch').addEventListener('input', renderProgress);
    $('progressStatusFilter').addEventListener('change', renderProgress);
    $('addProjectButton').addEventListener('click', () => projectEditor());
    $('addEnrolmentButton').addEventListener('click', enrolmentEditor);
    $('editorForm').addEventListener('submit', submitModal);
    $('closeDialog').addEventListener('click', closeModal);
    $('cancelDialog').addEventListener('click', closeModal);
    $('editorDialog').addEventListener('click', event => {
      if (event.target === $('editorDialog')) closeModal();
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button) clickAction(button);
    });
    document.querySelectorAll('a[href="#"]').forEach(link => link.addEventListener('click', event => event.preventDefault()));
  }

  async function start() {
    if (!window.supabaseClient) {
      showNotice('Supabase has not initialized. Check that supabase-config.js loads after the Supabase JavaScript library.', 'error');
      $('connectionLabel').textContent = 'Supabase unavailable';
      $('connectionLabel').parentElement.classList.add('error');
      return;
    }
    state.supabase = window.supabaseClient;
    bindEvents();
    try {
      const allowed = await checkAdministrator();
      if (!allowed) return;
      await loadData();
      showNotice('Administrator access verified. Data shown here comes from your Supabase records.', 'success');
    } catch (error) {
      $('connectionLabel').textContent = 'Could not load administrator data';
      $('connectionLabel').parentElement.classList.add('error');
      showNotice(error?.message || 'Unable to load the administrator dashboard. Check your Supabase migration and administrator permissions.', 'error');
      console.error('[AgriPredict admin startup]', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
