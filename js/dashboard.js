/* CampusFix student dashboard: summary, complaint list, notices and reporting. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N) {
        return;
    }

    const PAGE_SIZE = 8;
    const STATUSES = [
        "Pending",
        "Assigned",
        "In Progress",
        "Resolved",
        "Reopened",
        "Rejected"
    ];
    const PRIORITIES = ["Low", "Medium", "High", "Critical"];
    const SORTS = ["newest", "oldest", "priority", "due"];

    const elements = {
        welcome: document.getElementById("welcomeHeading"),
        newButton: document.getElementById("newComplaintButton"),
        quickNew: document.getElementById("quickNewComplaint"),
        refresh: document.getElementById("refreshComplaints"),
        search: document.getElementById("complaintSearch"),
        status: document.getElementById("complaintStatus"),
        priority: document.getElementById("complaintPriority"),
        sort: document.getElementById("complaintSort"),
        list: document.getElementById("complaintsContainer"),
        pagination: document.getElementById("complaintsPagination"),
        notices: document.getElementById("noticesPreview"),
        total: document.getElementById("summaryTotal"),
        open: document.getElementById("summaryOpen"),
        resolved: document.getElementById("summaryResolved"),
        overdue: document.getElementById("summaryOverdue"),
        resolvedMeta: document.getElementById("summaryResolvedMeta"),
        dialog: document.getElementById("complaintDialog"),
        form: document.getElementById("complaintForm"),
        title: document.getElementById("complaintTitle"),
        category: document.getElementById("complaintCategory"),
        description: document.getElementById("complaintDescription"),
        location: document.getElementById("complaintLocation"),
        titleCount: document.getElementById("titleCount"),
        descriptionCount: document.getElementById("descriptionCount"),
        submit: document.getElementById("complaintSubmit"),
        duplicateBox: document.getElementById("duplicateBox"),
        duplicateList: document.getElementById("duplicateList"),
        geoStatus: document.getElementById("geoStatus"),
        useLocation: document.getElementById("useLocationButton"),
        photoInput: document.getElementById("complaintPhoto"),
        choosePhoto: document.getElementById("choosePhotoButton"),
        removePhoto: document.getElementById("removePhotoButton"),
        photoPreview: document.getElementById("photoPreview"),
        photoPreviewImage: document.getElementById("photoPreviewImage"),
        photoHint: document.getElementById("photoHint"),
        photoError: document.getElementById("photoError"),
        anonymous: document.getElementById("anonymousCheckbox")
    };

    const state = {
        user: null,
        meta: null,
        summary: null,
        complaints: [],
        pagination: null,
        notices: [],
        filters: {
            search: "",
            status: "",
            priority: "",
            sort: "newest",
            page: 1
        },
        listLoading: false,
        listRequest: 0,
        duplicateTimer: null,
        duplicateRequest: 0,
        coordinates: null,
        photo: null,
        photoBusy: false
    };

    const icon = (name, extra) => App.icon(name, extra);
    const escape = App.escapeHTML;
    const t = (key, vars) => I18N.t(key, vars);

    function currentFirstName() {
        return String(state.user && state.user.name ? state.user.name : "")
            .trim()
            .split(/\s+/)[0];
    }

    function updateGreeting() {
        if (!elements.welcome) {
            return;
        }

        elements.welcome.textContent = t("dashboard.greeting", {
            name: currentFirstName() || t("common.you")
        });
    }

    function parseFilters() {
        const params = new URLSearchParams(window.location.search);
        const status = params.get("status") || "";
        const priority = params.get("priority") || "";
        const sort = params.get("sort") || "newest";
        const page = Number(params.get("page") || 1);

        state.filters = {
            search: String(params.get("search") || "").slice(0, 200),
            status: STATUSES.includes(status) ? status : "",
            priority: PRIORITIES.includes(priority) ? priority : "",
            sort: SORTS.includes(sort) ? sort : "newest",
            page:
                Number.isInteger(page) && page >= 1 && page <= 100000
                    ? page
                    : 1
        };
    }

    function applyFiltersToControls() {
        elements.search.value = state.filters.search;
        elements.status.value = state.filters.status;
        elements.priority.value = state.filters.priority;
        elements.sort.value = state.filters.sort;
    }

    function syncUrl() {
        const params = new URLSearchParams();

        if (state.filters.search) {
            params.set("search", state.filters.search);
        }

        if (state.filters.status) {
            params.set("status", state.filters.status);
        }

        if (state.filters.priority) {
            params.set("priority", state.filters.priority);
        }

        if (state.filters.sort !== "newest") {
            params.set("sort", state.filters.sort);
        }

        if (state.filters.page > 1) {
            params.set("page", String(state.filters.page));
        }

        const query = params.toString();
        window.history.replaceState(
            null,
            "",
            window.location.pathname + (query ? "?" + query : "")
        );
    }

    function skeletonList() {
        return (
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:26%"></span><span class="skeleton skeleton-line" style="width:16%;margin-left:auto"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:62%"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:38%"></span><span class="skeleton skeleton-line" style="width:22%;margin-left:auto"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:52%"></span></div>'
        );
    }

    function setLoading(loading) {
        state.listLoading = loading;
        elements.list.setAttribute("aria-busy", String(loading));
    }

    async function loadSummary() {
        try {
            const summary = await App.api.get("/complaints/summary");
            state.summary = summary;
            renderSummary();
        } catch (error) {
            state.summary = null;
            renderSummary();
        }
    }

    function renderSummary() {
        const summary = state.summary;
        const values = [elements.total, elements.open, elements.resolved, elements.overdue];

        values.forEach((node) => {
            node.removeAttribute("aria-busy");
        });

        if (!summary) {
            values.forEach((node) => {
                node.textContent = "—";
            });
            elements.resolvedMeta.textContent = t("common.unknown");
            return;
        }

        const open =
            Number(summary.pending || 0) +
            Number(summary.assigned || 0) +
            Number(summary.inProgress || 0) +
            Number(summary.reopened || 0);

        elements.total.textContent = I18N.formatNumber(summary.total);
        elements.open.textContent = I18N.formatNumber(open);
        elements.resolved.textContent = I18N.formatNumber(summary.resolved);
        elements.overdue.textContent = I18N.formatNumber(summary.overdue);
        elements.resolvedMeta.textContent = t("dashboard.resolvedMeta", {
            count: I18N.formatNumber(summary.resolved),
            total: I18N.formatNumber(summary.total)
        });
    }

    async function loadComplaints() {
        const request = ++state.listRequest;

        setLoading(true);
        elements.pagination.innerHTML = "";
        elements.list.innerHTML = skeletonList();

        const params = new URLSearchParams({
            page: String(state.filters.page),
            pageSize: String(PAGE_SIZE),
            sort: state.filters.sort
        });

        if (state.filters.search) {
            params.set("search", state.filters.search);
        }

        if (state.filters.status) {
            params.set("status", state.filters.status);
        }

        if (state.filters.priority) {
            params.set("priority", state.filters.priority);
        }

        try {
            const data = await App.api.get(
                "/complaints/mine?" + params.toString()
            );

            if (request !== state.listRequest) {
                return;
            }

            state.complaints = data.complaints || [];
            state.pagination = data.pagination || null;

            if (
                state.pagination &&
                state.pagination.total > 0 &&
                state.pagination.totalPages > 0 &&
                state.filters.page > state.pagination.totalPages
            ) {
                state.filters.page = state.pagination.totalPages;
                syncUrl();
                loadComplaints();
                return;
            }

            renderComplaintList();
            renderPagination();
        } catch (error) {
            if (request !== state.listRequest) {
                return;
            }

            state.complaints = [];
            state.pagination = null;
            renderListError(App.friendlyError(error, t("common.loadingError")));
        } finally {
            if (request === state.listRequest) {
                setLoading(false);
            }
        }
    }

    function dueMarkup(complaint) {
        if (complaint.status === "Resolved") {
            return (
                '<span class="text-xs subtle">' +
                icon("check-circle") +
                " " +
                escape(t("complaint.resolvedOn", {
                    date: I18N.formatDate(complaint.resolvedAt)
                })) +
                "</span>"
            );
        }

        if (complaint.status === "Rejected") {
            return (
                '<span class="text-xs subtle">' +
                escape(I18N.statusLabel(complaint.status)) +
                "</span>"
            );
        }

        if (complaint.isOverdue) {
            return (
                '<span class="badge badge-overdue">' +
                icon("clock", "icon-xs") +
                " " +
                escape(I18N.dueLabel(complaint.dueAt, true)) +
                "</span>"
            );
        }

        return (
            '<span class="text-xs subtle">' +
            icon("clock", "icon-xs") +
            " " +
            escape(I18N.dueDateLabel(complaint.dueAt)) +
            "</span>"
        );
    }

    function complaintCard(complaint) {
        const meta = [];

        meta.push(
            '<span>' +
                icon("tag", "icon-xs") +
                " " +
                escape(I18N.categoryLabel(complaint.category)) +
                "</span>"
        );
        meta.push(
            '<span>' +
                icon("map-pin", "icon-xs") +
                " " +
                escape(complaint.location) +
                "</span>"
        );

        if (complaint.department) {
            meta.push(
                '<span>' +
                    icon("building", "icon-xs") +
                    " " +
                    escape(I18N.departmentLabel(complaint.department.name)) +
                    "</span>"
            );
        }

        if (complaint.assignedTo) {
            meta.push(
                '<span>' +
                    icon("user", "icon-xs") +
                    " " +
                    escape(t("dashboard.assignedTo", {
                        name: complaint.assignedTo.name
                    })) +
                    "</span>"
            );
        }

        return (
            '<a class="complaint-card" href="' +
            escape(App.complaintUrl(complaint.id)) +
            '">' +
            '<div class="complaint-card-top">' +
            '<span class="complaint-card-ref">' +
            escape(complaint.referenceNumber) +
            "</span>" +
            '<span class="cluster cluster-tight">' +
            App.priorityBadge(complaint.priority) +
            App.statusBadge(complaint.status) +
            "</span></div>" +
            "<h3>" +
            escape(complaint.title) +
            "</h3>" +
            '<div class="complaint-card-meta">' +
            meta.join("") +
            "</div>" +
            '<div class="complaint-card-footer">' +
            '<span class="text-xs subtle">' +
            icon("calendar", "icon-xs") +
            " " +
            escape(t("dashboard.submittedOn", {
                date: I18N.formatDate(complaint.createdAt)
            })) +
            "</span>" +
            dueMarkup(complaint) +
            "</div></a>"
        );
    }

    function renderComplaintList() {
        if (state.complaints.length === 0) {
            const filtered = Boolean(
                state.filters.search ||
                    state.filters.status ||
                    state.filters.priority
            );

            elements.list.innerHTML =
                '<div class="empty-state">' +
                '<span class="empty-icon">' +
                icon(filtered ? "search" : "tickets") +
                "</span><h3>" +
                escape(t(filtered ? "dashboard.noMatchTitle" : "dashboard.emptyTitle")) +
                "</h3><p>" +
                escape(t(filtered ? "dashboard.noMatchBody" : "dashboard.emptyBody")) +
                "</p>" +
                (filtered
                    ? '<button type="button" class="btn btn-secondary btn-sm" data-clear-filters>' +
                      escape(t("admin.clearFilters")) +
                      "</button>"
                    : '<button type="button" class="btn btn-primary btn-sm" data-empty-new>' +
                      icon("plus") +
                      escape(t("dashboard.emptyAction")) +
                      "</button>") +
                "</div>";
            return;
        }

        elements.list.innerHTML = state.complaints
            .map(complaintCard)
            .join("");
    }

    function renderPagination() {
        const pagination = state.pagination;

        if (!pagination || pagination.total === 0) {
            elements.pagination.innerHTML = "";
            return;
        }

        const from = (pagination.page - 1) * pagination.pageSize + 1;
        const to = Math.min(
            pagination.page * pagination.pageSize,
            pagination.total
        );
        const pages = pagination.totalPages || 1;

        elements.pagination.innerHTML =
            '<div class="pagination"><span>' +
            escape(t("common.showing", {
                from: I18N.formatNumber(from),
                to: I18N.formatNumber(to),
                total: I18N.formatNumber(pagination.total)
            })) +
            '</span><div class="pagination-buttons">' +
            '<button type="button" class="page-btn" data-page="' +
            (pagination.page - 1) +
            '" aria-label="' +
            escape(t("common.previous")) +
            '"' +
            (pagination.page <= 1 ? " disabled" : "") +
            ">" +
            icon("chevron-left") +
            "</button>" +
            '<span class="page-btn is-current" aria-current="page">' +
            escape(String(pagination.page)) +
            " / " +
            escape(String(pages)) +
            "</span>" +
            '<button type="button" class="page-btn" data-page="' +
            (pagination.page + 1) +
            '" aria-label="' +
            escape(t("common.next")) +
            '"' +
            (pagination.page >= pages ? " disabled" : "") +
            ">" +
            icon("chevron-right") +
            "</button></div></div>";
    }

    function renderListError(message) {
        elements.list.innerHTML =
            '<div class="error-state" style="margin:16px">' +
            icon("alert-circle") +
            "<div><strong>" +
            escape(t("common.errorTitle")) +
            "</strong><p>" +
            escape(message) +
            '</p><button type="button" class="btn btn-secondary btn-sm" data-retry-complaints style="margin-top:9px">' +
            escape(t("common.retry")) +
            "</button></div></div>";
        elements.pagination.innerHTML = "";
    }

    async function loadNotices() {
        try {
            const data = await App.api.get("/notices?limit=4");
            state.notices = data.notices || [];
            renderNotices();
        } catch (error) {
            elements.notices.innerHTML =
                '<div class="empty-state" style="padding:28px 18px">' +
                '<span class="empty-icon">' +
                icon("alert-circle") +
                "</span><p>" +
                escape(t("common.loadingError")) +
                '</p><button type="button" class="btn btn-secondary btn-sm" data-retry-notices>' +
                escape(t("common.retry")) +
                "</button></div>";
        }
    }

    function renderNotices() {
        if (state.notices.length === 0) {
            elements.notices.innerHTML =
                '<div class="empty-state" style="padding:28px 18px;border:0;box-shadow:none">' +
                '<span class="empty-icon">' +
                icon("megaphone") +
                "</span><p>" +
                escape(t("dashboard.noNotices")) +
                "</p></div>";
            return;
        }

        elements.notices.innerHTML =
            '<div class="notice-list">' +
            state.notices
                .map((notice) => {
                    const body = String(notice.body || "")
                        .replace(/\s+/g, " ")
                        .trim();
                    const excerpt =
                        body.length > 170
                            ? body.slice(0, 167) + "…"
                            : body;

                    return (
                        '<article class="notice-item' +
                        (notice.priority === "High" ? " is-high" : "") +
                        '">' +
                        '<span class="notice-icon">' +
                        icon("megaphone") +
                        "</span>" +
                        '<div class="notice-body"><h3>' +
                        escape(notice.title) +
                        "</h3><p>" +
                        escape(excerpt) +
                        '</p><div class="notice-meta"><span>' +
                        escape(I18N.audienceLabel(notice.audience)) +
                        "</span><span>·</span><span>" +
                        escape(I18N.formatDate(notice.publishedAt)) +
                        "</span></div></div></article>"
                    );
                })
                .join("") +
            "</div>";
    }

    function updateCounters() {
        elements.titleCount.textContent = t("dashboard.titleCount", {
            count: I18N.formatNumber(elements.title.value.length)
        });
        elements.descriptionCount.textContent = t(
            "dashboard.descriptionCount",
            { count: I18N.formatNumber(elements.description.value.length) }
        );
    }

    function populateCategories() {
        if (!state.meta) {
            return;
        }

        const previous = elements.category.value;
        const options = [
            '<option value="">' +
                escape(t("dashboard.chooseCategory")) +
                "</option>"
        ];

        (state.meta.categories || []).forEach((category) => {
            options.push(
                '<option value="' +
                escape(category.name) +
                '" title="' +
                escape(I18N.departmentLabel(category.departmentName)) +
                '">' +
                escape(I18N.categoryLabel(category.name)) +
                " — " +
                escape(I18N.departmentLabel(category.departmentName)) +
                "</option>"
            );
        });

        elements.category.innerHTML = options.join("");

        if (
            previous &&
            (state.meta.categories || []).some(
                (category) => category.name === previous
            )
        ) {
            elements.category.value = previous;
        } else {
            elements.category.value = "";
        }
    }

    function applySlaHints() {
        if (!state.meta) {
            return;
        }

        const byPriority = {};
        (state.meta.sla || []).forEach((item) => {
            byPriority[item.priority] = item.responseHours;
        });

        ["Low", "Medium", "High", "Critical"].forEach((priority) => {
            const node = document.getElementById("slaHint" + priority);

            if (!node) {
                return;
            }

            node.removeAttribute("data-i18n");

            if (byPriority[priority] !== undefined) {
                node.textContent = t("dashboard.slaHint", {
                    hours: I18N.formatNumber(byPriority[priority])
                });
            }
        });
    }

    async function loadMeta() {
        try {
            const data = await App.api.get("/complaints/meta");
            state.meta = data;
            populateCategories();
            applySlaHints();
            return true;
        } catch (error) {
            state.meta = null;
            return false;
        }
    }

    const MAX_PHOTO_BYTES = 800000;
    const MAX_PHOTO_DIMENSION = 1600;

    function setPhotoError(message) {
        if (elements.photoError) {
            elements.photoError.textContent = message || "";
        }
    }

    function clearPhoto() {
        if (state.photo && state.photo.previewUrl) {
            URL.revokeObjectURL(state.photo.previewUrl);
        }

        state.photo = null;
        state.photoBusy = false;

        if (elements.photoPreview) {
            elements.photoPreview.hidden = true;
        }

        if (elements.photoPreviewImage) {
            elements.photoPreviewImage.removeAttribute("src");
        }

        if (elements.photoInput) {
            elements.photoInput.value = "";
        }

        if (elements.photoHint) {
            elements.photoHint.textContent = t("dashboard.photoHint");
        }

        setPhotoError("");
    }

    function loadImageElement(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();

            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("image_load_failed"));
            };
            image.src = url;
        });
    }

    function canvasToBlob(canvas, quality) {
        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => resolve(blob),
                "image/jpeg",
                quality
            );
        });
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const result = String(reader.result || "");
                const comma = result.indexOf(",");

                resolve(comma === -1 ? "" : result.slice(comma + 1));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    async function preparePhoto(file) {
        if (!file) {
            return;
        }

        const allowed = ["image/jpeg", "image/png", "image/webp"];

        if (!allowed.includes(file.type)) {
            setPhotoError(t("dashboard.photoTypeError"));
            return;
        }

        setPhotoError("");
        state.photoBusy = true;
        elements.choosePhoto.disabled = true;
        elements.photoHint.textContent = t("dashboard.photoPreparing");

        try {
            const image = await loadImageElement(file);
            let width = image.naturalWidth || image.width;
            let height = image.naturalHeight || image.height;

            if (!width || !height) {
                throw new Error("invalid_dimensions");
            }

            const scale = Math.min(
                1,
                MAX_PHOTO_DIMENSION / Math.max(width, height)
            );
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext("2d");

            if (!context) {
                throw new Error("canvas_unavailable");
            }

            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);

            let blob = null;

            for (const quality of [0.86, 0.7, 0.55, 0.4]) {
                const candidate = await canvasToBlob(canvas, quality);

                if (candidate) {
                    blob = candidate;

                    if (candidate.size <= MAX_PHOTO_BYTES) {
                        break;
                    }
                }
            }

            if (!blob || blob.size > MAX_PHOTO_BYTES) {
                throw new Error("image_too_large");
            }

            const dataBase64 = await blobToBase64(blob);

            if (!dataBase64) {
                throw new Error("image_encode_failed");
            }

            if (state.photo && state.photo.previewUrl) {
                URL.revokeObjectURL(state.photo.previewUrl);
            }

            state.photo = {
                fileName: "photo.jpg",
                contentType: "image/jpeg",
                dataBase64,
                byteSize: blob.size,
                previewUrl: URL.createObjectURL(blob)
            };

            elements.photoPreviewImage.src = state.photo.previewUrl;
            elements.photoPreviewImage.alt = t(
                "dashboard.photoPreviewAlt"
            );
            elements.photoPreview.hidden = false;
            elements.photoHint.textContent = t("dashboard.photoReady", {
                size: I18N.formatNumber(
                    Math.max(1, Math.round(blob.size / 1024))
                )
            });
        } catch (error) {
            clearPhoto();
            setPhotoError(
                error && error.message === "image_too_large"
                    ? t("dashboard.photoTooLarge")
                    : t("dashboard.photoFailed")
            );
        } finally {
            state.photoBusy = false;
            elements.choosePhoto.disabled = false;
        }
    }

    async function openComplaintDialog() {
        if (!state.meta) {
            const loaded = await loadMeta();

            if (!loaded) {
                App.toast(
                    App.friendlyError(new Error(), t("common.loadingError")),
                    "error"
                );
                return;
            }
        }

        App.clearFieldErrors(elements.form);
        updateCounters();

        if (!elements.dialog.open) {
            elements.dialog.showModal();
            window.setTimeout(() => elements.title.focus(), 60);
        }
    }

    function closeComplaintDialog() {
        if (elements.dialog.open) {
            elements.dialog.close();
        }

        hideDuplicates();
        clearPhoto();
    }

    function hideDuplicates() {
        state.duplicateRequest += 1;
        window.clearTimeout(state.duplicateTimer);
        elements.duplicateBox.hidden = true;
        elements.duplicateList.innerHTML = "";
    }

    function scheduleDuplicateCheck() {
        window.clearTimeout(state.duplicateTimer);
        state.duplicateTimer = window.setTimeout(checkDuplicates, 450);
    }

    async function checkDuplicates() {
        const title = elements.title.value.trim();
        const location = elements.location.value.trim();
        const category = elements.category.value;
        const request = ++state.duplicateRequest;

        if (!elements.dialog.open || title.length < 4) {
            if (title.length < 4) {
                elements.duplicateBox.hidden = true;
            }
            return;
        }

        const params = new URLSearchParams({ title });

        if (category) {
            params.set("category", category);
        }

        if (location.length >= 3) {
            params.set("location", location);
        }

        try {
            const data = await App.api.get(
                "/complaints/similar?" + params.toString()
            );

            if (request !== state.duplicateRequest || !elements.dialog.open) {
                return;
            }

            const complaints = data.complaints || [];

            if (complaints.length === 0) {
                elements.duplicateBox.hidden = true;
                return;
            }

            elements.duplicateList.innerHTML = complaints
                .map(
                    (complaint) =>
                        '<a class="link-button text-sm" href="' +
                        escape(App.complaintUrl(complaint.id)) +
                        '">' +
                        escape(complaint.referenceNumber) +
                        " · " +
                        escape(complaint.title) +
                        " · " +
                        escape(I18N.statusLabel(complaint.status)) +
                        "</a>"
                )
                .join("");
            elements.duplicateBox.hidden = false;
        } catch (error) {
            if (request === state.duplicateRequest) {
                elements.duplicateBox.hidden = true;
            }
        }
    }

    function useDeviceLocation() {
        if (!navigator.geolocation) {
            App.toast(t("dashboard.locationUnavailable"), "warning");
            return;
        }

        const restore = App.buttonLoading(
            elements.useLocation,
            t("common.processing")
        );

        navigator.geolocation.getCurrentPosition(
            (position) => {
                restore();
                const latitude = Number(position.coords.latitude.toFixed(6));
                const longitude = Number(position.coords.longitude.toFixed(6));
                state.coordinates = { latitude, longitude };
                elements.geoStatus.textContent =
                    t("dashboard.locationAdded") +
                    " · " +
                    latitude.toFixed(4) +
                    ", " +
                    longitude.toFixed(4);
                App.toast(t("dashboard.locationAdded"), "success");
            },
            () => {
                restore();
                App.toast(t("dashboard.locationUnavailable"), "warning");
            },
            {
                enableHighAccuracy: false,
                timeout: 12000,
                maximumAge: 300000
            }
        );
    }

    function markInvalid(input, message, firstInvalid) {
        App.fieldError(input, message);

        if (!firstInvalid.input) {
            firstInvalid.input = input;
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.form);
        setPhotoError("");

        if (state.photoBusy) {
            App.toast(t("dashboard.photoPreparing"), "info");
            return;
        }

        const firstInvalid = { input: null };
        const title = elements.title.value.trim();
        const category = elements.category.value;
        const description = elements.description.value.trim();
        const location = elements.location.value.trim();
        const priorityInput = elements.form.querySelector(
            'input[name="priority"]:checked'
        );
        const priority = priorityInput ? priorityInput.value : "Medium";

        if (!title) {
            markInvalid(elements.title, t("common.requiredField"), firstInvalid);
        }

        if (!category) {
            markInvalid(elements.category, t("common.requiredField"), firstInvalid);
        }

        if (!description) {
            markInvalid(
                elements.description,
                t("common.requiredField"),
                firstInvalid
            );
        }

        if (!location) {
            markInvalid(elements.location, t("common.requiredField"), firstInvalid);
        }

        if (firstInvalid.input) {
            firstInvalid.input.focus();
            return;
        }

        const payload = {
            title,
            category,
            description,
            location,
            priority,
            anonymous: Boolean(
                elements.anonymous && elements.anonymous.checked
            )
        };

        if (state.coordinates) {
            payload.latitude = state.coordinates.latitude;
            payload.longitude = state.coordinates.longitude;
        }

        const photo = state.photo;
        const restore = App.buttonLoading(
            elements.submit,
            t("dashboard.submitting")
        );

        try {
            const data = await App.api.post("/complaints", payload);
            let photoFailed = false;

            if (photo) {
                try {
                    await App.api.post(
                        "/complaints/" +
                            encodeURIComponent(data.complaint.id) +
                            "/attachments",
                        {
                            fileName: photo.fileName,
                            contentType: photo.contentType,
                            dataBase64: photo.dataBase64
                        }
                    );
                } catch (uploadError) {
                    photoFailed = true;
                }
            }

            closeComplaintDialog();
            elements.form.reset();
            state.coordinates = null;
            elements.geoStatus.textContent = t("dashboard.locationHelp");
            updateCounters();

            state.filters = {
                search: "",
                status: "",
                priority: "",
                sort: "newest",
                page: 1
            };
            applyFiltersToControls();
            syncUrl();

            App.toast(
                t("dashboard.submitted", {
                    reference: data.complaint.referenceNumber
                }),
                "success",
                8000
            );

            if (photoFailed) {
                App.toast(
                    t("dashboard.photoUploadFailed"),
                    "warning",
                    8000
                );
            }

            await Promise.all([loadComplaints(), loadSummary()]);
        } catch (error) {
            restore();

            const mapped = { input: null };
            (error.errors || []).forEach((issue) => {
                const field = String(issue.path || "").split(".")[0];
                const input = elements.form.querySelector(
                    '[name="' + field + '"]'
                );

                if (input) {
                    markInvalid(
                        input,
                        issue.message || t("common.requiredField"),
                        mapped
                    );
                }
            });

            if (mapped.input) {
                mapped.input.focus();
            } else {
                App.toast(
                    App.friendlyError(error, t("dashboard.formError")),
                    "error",
                    7000
                );
            }
        }
    }

    function bindEvents() {
        elements.newButton.addEventListener("click", openComplaintDialog);
        elements.quickNew.addEventListener("click", openComplaintDialog);

        document.querySelectorAll("[data-close-complaint-dialog]").forEach(
            (button) => {
                button.addEventListener("click", closeComplaintDialog);
            }
        );

        elements.dialog.addEventListener("click", (event) => {
            if (event.target === elements.dialog) {
                closeComplaintDialog();
            }
        });

        elements.form.addEventListener("submit", handleSubmit);

        elements.title.addEventListener("input", () => {
            updateCounters();
            scheduleDuplicateCheck();
        });
        elements.description.addEventListener("input", updateCounters);
        elements.category.addEventListener("change", scheduleDuplicateCheck);
        elements.location.addEventListener("input", scheduleDuplicateCheck);
        elements.useLocation.addEventListener("click", useDeviceLocation);

        elements.choosePhoto.addEventListener("click", () => {
            elements.photoInput.click();
        });

        elements.photoInput.addEventListener("change", () => {
            const file = elements.photoInput.files
                ? elements.photoInput.files[0]
                : null;

            if (file) {
                preparePhoto(file);
            }
        });

        elements.removePhoto.addEventListener("click", clearPhoto);

        let searchTimer = null;

        elements.search.addEventListener("input", () => {
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => {
                state.filters.search = elements.search.value.trim();
                state.filters.page = 1;
                syncUrl();
                loadComplaints();
            }, 320);
        });

        elements.search.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                window.clearTimeout(searchTimer);
                state.filters.search = elements.search.value.trim();
                state.filters.page = 1;
                syncUrl();
                loadComplaints();
            }
        });

        elements.status.addEventListener("change", () => {
            state.filters.status = elements.status.value;
            state.filters.page = 1;
            syncUrl();
            loadComplaints();
        });

        elements.priority.addEventListener("change", () => {
            state.filters.priority = elements.priority.value;
            state.filters.page = 1;
            syncUrl();
            loadComplaints();
        });

        elements.sort.addEventListener("change", () => {
            state.filters.sort = elements.sort.value;
            state.filters.page = 1;
            syncUrl();
            loadComplaints();
        });

        elements.refresh.addEventListener("click", async () => {
            const restore = App.buttonLoading(
                elements.refresh,
                t("common.loading")
            );
            await Promise.all([loadSummary(), loadComplaints(), loadNotices()]);
            restore();
        });

        elements.list.addEventListener("click", (event) => {
            if (event.target.closest("[data-retry-complaints]")) {
                loadComplaints();
                return;
            }

            if (event.target.closest("[data-empty-new]")) {
                openComplaintDialog();
                return;
            }

            if (event.target.closest("[data-clear-filters]")) {
                state.filters = {
                    search: "",
                    status: "",
                    priority: "",
                    sort: state.filters.sort,
                    page: 1
                };
                applyFiltersToControls();
                syncUrl();
                loadComplaints();
            }
        });

        elements.pagination.addEventListener("click", (event) => {
            const button = event.target.closest("[data-page]");

            if (!button) {
                return;
            }

            const page = Number(button.getAttribute("data-page"));

            if (!Number.isInteger(page) || page < 1) {
                return;
            }

            state.filters.page = page;
            syncUrl();
            loadComplaints();
            elements.list.scrollIntoView({ behavior: "smooth", block: "start" });
        });

        elements.notices.addEventListener("click", (event) => {
            if (event.target.closest("[data-retry-notices]")) {
                loadNotices();
            }
        });

        window.addEventListener("campusfix:languagechange", () => {
            updateGreeting();
            updateCounters();
            populateCategories();
            applySlaHints();
            renderSummary();
            renderComplaintList();
            renderPagination();
            renderNotices();
        });
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        state.user = user;
        parseFilters();
        applyFiltersToControls();
        updateGreeting();
        bindEvents();

        await Promise.all([
            loadMeta(),
            loadSummary(),
            loadComplaints(),
            loadNotices()
        ]);
    }

    init();
})();
