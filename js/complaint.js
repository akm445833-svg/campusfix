/* CampusFix complaint detail: workflow, assignment, conversation and feedback. */
(function () {
    "use strict";

    const App = window.CampusFix;
    const I18N = window.CampusFixI18n;

    if (!App || !I18N) {
        return;
    }

    const TRANSITIONS = {
        Pending: ["Assigned", "In Progress", "Rejected"],
        Assigned: ["In Progress", "Rejected"],
        "In Progress": ["Resolved", "Rejected"],
        Resolved: ["Reopened"],
        Reopened: ["Assigned", "In Progress", "Resolved", "Rejected"],
        Rejected: ["Reopened"]
    };

    const EVENT_ICONS = {
        created: "plus",
        status_changed: "refresh",
        assigned: "user-plus",
        unassigned: "rotate-ccw",
        department_changed: "building",
        priority_changed: "alert-triangle",
        resolved: "check-circle",
        rejected: "x-circle",
        reopened: "rotate-ccw",
        feedback_submitted: "star",
        comment_added: "message",
        photo_added: "camera",
        photo_removed: "trash",
        status_imported: "file-text"
    };

    const KNOWN_EVENTS = Object.keys(EVENT_ICONS);

    const elements = {
        root: document.getElementById("complaintRoot"),
        statusDialog: document.getElementById("statusDialog"),
        statusForm: document.getElementById("statusForm"),
        statusSelect: document.getElementById("statusSelect"),
        statusHint: document.getElementById("statusHint"),
        statusResolution: document.getElementById("statusResolution"),
        statusRejection: document.getElementById("statusRejection"),
        statusNote: document.getElementById("statusNote"),
        resolutionField: document.getElementById("resolutionField"),
        rejectionField: document.getElementById("rejectionField"),
        statusSubmit: document.getElementById("statusSubmit"),
        assignmentDialog: document.getElementById("assignmentDialog"),
        assignmentForm: document.getElementById("assignmentForm"),
        assignmentDepartment: document.getElementById("assignmentDepartment"),
        assignmentAssignee: document.getElementById("assignmentAssignee"),
        assignmentSubmit: document.getElementById("assignmentSubmit"),
        priorityDialog: document.getElementById("priorityDialog"),
        priorityForm: document.getElementById("priorityForm"),
        prioritySubmit: document.getElementById("prioritySubmit")
    };

    const state = {
        user: null,
        complaintId: App.currentComplaintId(),
        data: null,
        complaint: null,
        permissions: {},
        notes: [],
        history: [],
        attachments: [],
        upvotes: { count: 0, hasUpvoted: false },
        rating: 0,
        loadToken: 0,
        assigneeToken: 0
    };

    const icon = (name, extra) => App.icon(name, extra);
    const escape = App.escapeHTML;
    const t = (key, vars) => I18N.t(key, vars);

    function isOperations() {
        return Boolean(state.user && state.user.role !== "student");
    }

    function backHref() {
        return isOperations()
            ? "admin.html?tab=complaints"
            : "dashboard.html";
    }

    function eventLabel(eventType) {
        return KNOWN_EVENTS.includes(eventType)
            ? I18N.eventLabel(eventType)
            : t("event.system");
    }

    function mapUrl(latitude, longitude) {
        const lat = Number(latitude);
        const lng = Number(longitude);

        return (
            "https://www.openstreetmap.org/?mlat=" +
            encodeURIComponent(String(lat)) +
            "&mlon=" +
            encodeURIComponent(String(lng)) +
            "#map=19/" +
            encodeURIComponent(String(lat)) +
            "/" +
            encodeURIComponent(String(lng))
        );
    }

    function renderSkeleton() {
        elements.root.innerHTML =
            '<div class="detail-layout" aria-busy="true">' +
            '<div class="detail-main">' +
            '<section class="panel detail-banner">' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:24%"></span><span class="skeleton skeleton-line" style="width:16%;margin-left:auto"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:68%;height:20px"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:48%"></span></div>' +
            "</section>" +
            '<section class="panel detail-section">' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:22%"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:92%"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:74%"></span></div>' +
            "</section></div>" +
            '<aside class="detail-side"><section class="panel side-card">' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:44%"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:80%"></span></div>' +
            '<div class="skeleton-row"><span class="skeleton skeleton-line" style="width:62%"></span></div>' +
            "</section></aside></div>";
    }

    function renderNotFound() {
        elements.root.innerHTML =
            '<div class="empty-state" style="margin-top:24px">' +
            '<span class="empty-icon">' +
            icon("search") +
            "</span><h1>" +
            escape(t("complaint.notFoundTitle")) +
            "</h1><p>" +
            escape(t("complaint.notFoundBody")) +
            '</p><a class="btn btn-primary" href="' +
            escape(backHref()) +
            '">' +
            icon("arrow-left") +
            escape(t("common.back")) +
            "</a></div>";
    }

    function renderError(message) {
        elements.root.innerHTML =
            '<div class="error-state" style="margin-top:24px">' +
            icon("alert-circle") +
            "<div><strong>" +
            escape(t("complaint.loadError")) +
            "</strong><p>" +
            escape(message) +
            '</p><div class="cluster" style="margin-top:10px">' +
            '<button type="button" class="btn btn-secondary btn-sm" data-retry-detail>' +
            escape(t("common.retry")) +
            "</button>" +
            '<a class="btn btn-ghost btn-sm" href="' +
            escape(backHref()) +
            '">' +
            escape(t("common.back")) +
            "</a></div></div></div>";
    }

    function statusMetaMarkup(complaint) {
        const parts = [];

        parts.push(
            '<span>' +
                icon("tag") +
                escape(I18N.categoryLabel(complaint.category)) +
                "</span>"
        );
        parts.push(
            '<span>' +
                icon("building") +
                escape(I18N.departmentLabel(complaint.department.name)) +
                "</span>"
        );
        parts.push(
            '<span>' +
                icon("user") +
                escape(complaint.createdBy.name) +
                "</span>"
        );
        parts.push(
            '<span>' +
                icon("calendar") +
                escape(
                    t("dashboard.submittedOn", {
                        date: I18N.formatDate(complaint.createdAt)
                    })
                ) +
                "</span>"
        );
        parts.push(
            '<span>' +
                icon("clock") +
                escape(
                    complaint.status === "Resolved" ||
                        complaint.status === "Rejected"
                        ? I18N.dueDateLabel(complaint.dueAt)
                        : I18N.dueLabel(complaint.dueAt, complaint.isOverdue)
                ) +
                "</span>"
        );

        return parts.join("");
    }

    function locationMarkup(complaint) {
        const hasCoordinates =
            complaint.latitude !== null &&
            complaint.latitude !== undefined &&
            complaint.longitude !== null &&
            complaint.longitude !== undefined;

        let coordinates = escape(t("common.notProvided"));

        if (hasCoordinates) {
            coordinates =
                escape(
                    Number(complaint.latitude).toFixed(5) +
                        ", " +
                        Number(complaint.longitude).toFixed(5)
                ) +
                ' · <a class="link-button text-xs" href="' +
                escape(mapUrl(complaint.latitude, complaint.longitude)) +
                '" target="_blank" rel="noopener noreferrer">' +
                escape(t("complaint.viewMap")) +
                " " +
                icon("external-link", "icon-xs") +
                "</a>";
        }

        return (
            '<div class="divider"></div>' +
            '<dl class="definition-grid">' +
            "<div><dt>" +
            escape(t("complaint.location")) +
            "</dt><dd>" +
            escape(complaint.location) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("complaint.coordinates")) +
            "</dt><dd>" +
            coordinates +
            "</dd></div></dl>"
        );
    }

    function commentMarkup(note) {
        const internal = note.visibility === "internal";
        const author = note.authorName || t("complaint.unknownAuthor");
        const isCurrent =
            note.authorId && state.user && note.authorId === state.user.id;

        return (
            '<article class="comment' +
            (internal ? " is-internal" : "") +
            '">' +
            App.avatar(note.authorName || "?") +
            '<div class="comment-bubble">' +
            '<div class="comment-head"><strong>' +
            escape(isCurrent ? t("common.you") : author) +
            "</strong>" +
            (internal
                ? '<span class="badge" data-tone="pending">' +
                  escape(t("complaint.internal")) +
                  "</span>"
                : "") +
            "<time datetime=\"" +
            escape(note.createdAt || "") +
            '">' +
            escape(I18N.formatDateTime(note.createdAt)) +
            "</time></div><p>" +
            escape(note.message) +
            "</p></div></article>"
        );
    }

    function commentListMarkup(notes) {
        if (!notes.length) {
            return '<p class="muted text-sm">' + escape(t("complaint.noComments")) + "</p>";
        }

        return '<div class="comment-list">' + notes.map(commentMarkup).join("") + "</div>";
    }

    function commentFormMarkup(visibility) {
        const internal = visibility === "internal";
        const id = internal ? "internalNoteMessage" : "publicCommentMessage";

        return (
            '<form class="comment-form" data-comment-form data-visibility="' +
            visibility +
            '">' +
            '<div class="field"><label class="sr-only" for="' +
            id +
            '">' +
            escape(t(internal ? "complaint.addInternalNote" : "complaint.addComment")) +
            '</label><textarea id="' +
            id +
            '" name="message" maxlength="5000" required placeholder="' +
            escape(
                t(
                    internal
                        ? "complaint.internalPlaceholder"
                        : "complaint.commentPlaceholder"
                )
            ) +
            '"></textarea><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="comment-form-footer"><span class="field-hint">' +
            escape(t(internal ? "complaint.internalNotesHint" : "complaint.publicHint")) +
            "</span>" +
            '<button type="submit" class="btn btn-secondary btn-sm">' +
            icon("send") +
            escape(t("complaint.post")) +
            "</button></div></form>"
        );
    }

    function starsScoreMarkup(rating) {
        let markup = '<div class="feedback-score" aria-hidden="true">';

        for (let value = 1; value <= 5; value += 1) {
            markup +=
                '<span class="' +
                (value <= rating ? "" : "is-off") +
                '">' +
                icon("star") +
                "</span>";
        }

        return markup + "</div>";
    }

    function feedbackPanelMarkup(complaint) {
        if (complaint.feedback) {
            const feedback = complaint.feedback;

            return (
                '<section class="panel detail-section" aria-labelledby="feedbackTitle">' +
                '<h2 id="feedbackTitle">' +
                icon("star") +
                " " +
                escape(t("complaint.feedbackGiven")) +
                "</h2>" +
                '<div class="feedback-box">' +
                starsScoreMarkup(Number(feedback.rating || 0)) +
                "<p class=\"text-sm\"><strong>" +
                escape(
                    t("complaint.ratingLabel", {
                        stars: I18N.formatNumber(feedback.rating)
                    })
                ) +
                "</strong></p>" +
                (feedback.comment
                    ? '<p class="prose">' + escape(feedback.comment) + "</p>"
                    : "") +
                '<time class="text-xs subtle" datetime="' +
                escape(feedback.at || "") +
                '">' +
                escape(I18N.formatDateTime(feedback.at)) +
                "</time></div></section>"
            );
        }

        if (!state.permissions.canFeedback) {
            return "";
        }

        let buttons = "";

        for (let value = 1; value <= 5; value += 1) {
            buttons +=
                '<button type="button" data-feedback-star="' +
                value +
                '" aria-pressed="false" aria-label="' +
                escape(t("complaint.ratingLabel", { stars: value })) +
                '">' +
                icon("star") +
                "</button>";
        }

        return (
            '<section class="panel detail-section" aria-labelledby="feedbackTitle">' +
            '<h2 id="feedbackTitle">' +
            escape(t("complaint.feedbackTitle")) +
            "</h2>" +
            '<form data-feedback-form novalidate><div class="field">' +
            '<p class="field-hint" style="margin:0">' +
            escape(t("complaint.feedbackPrompt")) +
            "</p>" +
            '<div class="star-rating" role="group" aria-label="' +
            escape(t("complaint.feedbackTitle")) +
            '">' +
            buttons +
            "</div>" +
            '<span class="field-error" id="feedbackError" aria-live="polite"></span>' +
            "</div>" +
            '<div class="field"><label for="feedbackComment">' +
            escape(t("complaint.note")) +
            '</label><textarea id="feedbackComment" name="comment" maxlength="2000" placeholder="' +
            escape(t("complaint.feedbackPlaceholder")) +
            '"></textarea><span class="field-error" aria-live="polite"></span></div>' +
            '<div class="cluster" style="justify-content:flex-end">' +
            '<button type="submit" class="btn btn-primary">' +
            icon("star") +
            escape(t("complaint.submitFeedback")) +
            "</button></div></form></section>"
        );
    }

    function reopenPanelMarkup(complaint) {
        if (state.permissions.canReopen) {
            return (
                '<section class="panel detail-section" aria-labelledby="reopenTitle">' +
                '<h2 id="reopenTitle">' +
                escape(t("complaint.reopenTitle")) +
                "</h2><p class=\"field-hint\">" +
                escape(t("complaint.reopenPrompt")) +
                "</p>" +
                '<form data-reopen-form novalidate><div class="field">' +
                '<label class="sr-only" for="reopenReason">' +
                escape(t("complaint.reopenTitle")) +
                '</label><textarea id="reopenReason" name="reason" maxlength="2000" required placeholder="' +
                escape(t("complaint.reopenPlaceholder")) +
                '"></textarea><span class="field-error" aria-live="polite"></span></div>' +
                (state.data && state.data.reopenWindowEndsAt
                    ? '<p class="field-hint">' +
                      escape(
                          t("complaint.reopenWindowEnds", {
                              date: I18N.formatDate(state.data.reopenWindowEndsAt)
                          })
                      ) +
                      "</p>"
                    : "") +
                '<div class="cluster" style="justify-content:flex-end">' +
                '<button type="submit" class="btn btn-secondary">' +
                icon("rotate-ccw") +
                escape(t("complaint.reopenSubmit")) +
                "</button></div></form></section>"
            );
        }

        if (
            state.permissions.isOwner &&
            complaint.status === "Resolved" &&
            state.data &&
            state.data.reopenWindowEndsAt
        ) {
            return (
                '<section class="panel detail-section">' +
                '<p class="field-hint">' +
                escape(t("error.reopen_window_closed")) +
                "</p></section>"
            );
        }

        return "";
    }

    function timelineMarkup() {
        if (!state.history.length) {
            return '<p class="muted text-sm">' + escape(t("complaint.noHistory")) + "</p>";
        }

        return (
            '<div class="timeline">' +
            state.history
                .map((event) => {
                    const from = event.fromStatus
                        ? App.statusBadge(event.fromStatus)
                        : "";
                    const to = event.toStatus
                        ? App.statusBadge(event.toStatus)
                        : "";
                    const transition =
                        from || to
                            ? '<div class="cluster cluster-tight" style="margin:4px 0">' +
                              from +
                              (from && to ? icon("arrow-right", "icon-xs") : "") +
                              to +
                              "</div>"
                            : "";

                    return (
                        '<article class="timeline-item">' +
                        '<span class="timeline-dot">' +
                        icon(EVENT_ICONS[event.eventType] || "activity") +
                        "</span>" +
                        '<div class="timeline-copy"><strong>' +
                        escape(eventLabel(event.eventType)) +
                        "</strong>" +
                        transition +
                        (event.message
                            ? "<p>" + escape(event.message) + "</p>"
                            : "") +
                        '<div class="text-xs subtle"><time datetime="' +
                        escape(event.createdAt || "") +
                        '">' +
                        escape(I18N.formatDateTime(event.createdAt)) +
                        "</time>" +
                        (event.actorName
                            ? " · " + escape(event.actorName)
                            : "") +
                        "</div></div></article>"
                    );
                })
                .join("") +
            "</div>"
        );
    }

    function attachmentUrl(attachmentId) {
        return (
            "/api/complaints/" +
            encodeURIComponent(state.complaintId) +
            "/attachments/" +
            encodeURIComponent(attachmentId)
        );
    }

    function attachmentsMarkup() {
        if (!state.attachments.length) {
            return "";
        }

        const tiles = state.attachments
            .map((attachment) => {
                const canRemove =
                    isOperations() ||
                    attachment.uploadedById === state.user.id;
                const url = attachmentUrl(attachment.id);

                return (
                    '<figure class="attachment-tile">' +
                    '<a href="' +
                    escape(url) +
                    '" target="_blank" rel="noopener">' +
                    '<img src="' +
                    escape(url) +
                    '" alt="' +
                    escape(attachment.fileName) +
                    '" loading="lazy">' +
                    "</a>" +
                    '<figcaption><span>' +
                    escape(attachment.fileName) +
                    '</span><span class="text-xs subtle">' +
                    escape(
                        I18N.formatNumber(
                            Math.max(
                                1,
                                Math.round(attachment.byteSize / 1024)
                            )
                        )
                    ) +
                    " KB</span>" +
                    (canRemove
                        ? '<button type="button" class="btn btn-ghost btn-icon" data-remove-attachment="' +
                          escape(attachment.id) +
                          '" data-i18n-aria-label="dashboard.photoRemove" aria-label="Remove photo">' +
                          icon("trash") +
                          "</button>"
                        : "") +
                    "</figcaption></figure>"
                );
            })
            .join("");

        return (
            '<section class="panel detail-section" aria-labelledby="photosTitle">' +
            '<h2 id="photosTitle">' +
            icon("camera") +
            " " +
            escape(t("complaint.photosTitle")) +
            '</h2><div class="attachment-grid">' +
            tiles +
            "</div></section>"
        );
    }

    function upvoteMarkup(complaint) {
        const count = Number(
            state.upvotes && state.upvotes.count
                ? state.upvotes.count
                : complaint.upvoteCount || 0
        );
        const active = Boolean(
            state.upvotes && state.upvotes.hasUpvoted
        );
        const label = active
            ? t("complaint.upvoted")
            : t("complaint.upvote");
        const countLabel = t("complaint.upvoteCount", {
            count: I18N.formatNumber(count)
        });

        return (
            '<button type="button" class="upvote-button' +
            (active ? " is-active" : "") +
            '" id="upvoteButton" aria-pressed="' +
            (active ? "true" : "false") +
            '" aria-label="' +
            escape(label + " · " + countLabel) +
            '">' +
            icon("thumbs-up") +
            "<span>" +
            escape(label) +
            '</span><strong aria-hidden="true">' +
            escape(I18N.formatNumber(count)) +
            "</strong></button>"
        );
    }

    function sidePanelMarkup(complaint) {
        const due =
            complaint.status === "Resolved" ||
            complaint.status === "Rejected"
                ? I18N.dueDateLabel(complaint.dueAt)
                : I18N.dueLabel(complaint.dueAt, complaint.isOverdue);
        const actions = [];

        if (state.permissions.canUpdateStatus) {
            actions.push(
                '<button type="button" class="btn btn-primary" id="updateStatusButton">' +
                    icon("refresh") +
                    escape(t("complaint.updateStatus")) +
                    "</button>"
            );
        }

        if (state.permissions.canAssign) {
            actions.push(
                '<button type="button" class="btn btn-secondary" id="assignButton">' +
                    icon("user-plus") +
                    escape(t("complaint.assign")) +
                    "</button>"
            );
        }

        if (state.permissions.canManage) {
            actions.push(
                '<button type="button" class="btn btn-secondary" id="changePriorityButton">' +
                    icon("alert-triangle") +
                    escape(t("complaint.changePriority")) +
                    "</button>"
            );
        }

        actions.push(
            '<button type="button" class="btn btn-secondary" id="copyReferenceButton">' +
                icon("copy") +
                escape(t("complaint.copyReference")) +
                "</button>"
        );

        if (state.user.role === "admin") {
            actions.push(
                '<button type="button" class="btn btn-danger" id="deleteComplaintButton">' +
                    icon("trash") +
                    escape(t("complaint.deleteComplaint")) +
                    "</button>"
            );
        }

        return (
            '<aside class="detail-side">' +
            '<section class="panel side-card"><h2>' +
            escape(t("complaint.detailsTitle")) +
            '</h2><dl class="side-stats">' +
            "<div><dt>" +
            escape(t("common.status")) +
            "</dt><dd>" +
            App.statusBadge(complaint.status) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("common.priority")) +
            "</dt><dd>" +
            App.priorityBadge(complaint.priority) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("common.category")) +
            "</dt><dd>" +
            escape(I18N.categoryLabel(complaint.category)) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("common.department")) +
            "</dt><dd>" +
            escape(I18N.departmentLabel(complaint.department.name)) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("complaint.assignedTo")) +
            "</dt><dd>" +
            (complaint.assignedTo
                ? escape(complaint.assignedTo.name)
                : escape(t("complaint.unassigned"))) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("complaint.createdAt")) +
            "</dt><dd>" +
            escape(I18N.formatDateTime(complaint.createdAt)) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("complaint.updatedAt")) +
            "</dt><dd>" +
            escape(I18N.formatDateTime(complaint.updatedAt)) +
            "</dd></div>" +
            "<div><dt>" +
            escape(t("complaint.due")) +
            "</dt><dd>" +
            escape(due) +
            "</dd></div></dl></section>" +
            '<section class="panel side-card"><h2>' +
            escape(t("complaint.actionsTitle")) +
            "</h2>" +
            actions.join("") +
            "</section></aside>"
        );
    }

    function renderPage() {
        const complaint = state.complaint;

        if (!complaint) {
            return;
        }

        const publicNotes = state.notes.filter(
            (note) => note.visibility !== "internal"
        );
        const internalNotes = state.notes.filter(
            (note) => note.visibility === "internal"
        );
        const rejection = complaint.rejectionReason
            ? '<section class="panel detail-section rejection-card"><h2>' +
              icon("x-circle") +
              " " +
              escape(t("complaint.rejectionTitle")) +
              '</h2><p class="prose">' +
              escape(complaint.rejectionReason) +
              "</p></section>"
            : "";
        const resolution = complaint.resolution
            ? '<section class="panel detail-section resolution-card"><h2>' +
              icon("check-circle") +
              " " +
              escape(t("complaint.resolutionTitle")) +
              '</h2><p class="prose">' +
              escape(complaint.resolution) +
              "</p>" +
              (complaint.resolvedAt
                  ? '<p class="text-xs subtle">' +
                    escape(
                        t("complaint.resolvedOn", {
                            date: I18N.formatDateTime(complaint.resolvedAt)
                        })
                    ) +
                    "</p>"
                  : "") +
              "</section>"
            : "";
        const internalPanel = state.permissions.canCreateInternalNote
            ? '<section class="panel detail-section" aria-labelledby="internalNotesTitle">' +
              '<h2 id="internalNotesTitle">' +
              escape(t("complaint.internalNotesTitle")) +
              '</h2><p class="field-hint">' +
              escape(t("complaint.internalNotesHint")) +
              "</p>" +
              commentListMarkup(internalNotes) +
              commentFormMarkup("internal") +
              "</section>"
            : "";

        elements.root.innerHTML =
            '<div class="spread" style="margin-bottom:14px">' +
            '<a class="link-button" href="' +
            escape(backHref()) +
            '">' +
            icon("arrow-left") +
            escape(t("complaint.back")) +
            "</a>" +
            '<span class="text-xs subtle mono">' +
            escape(complaint.referenceNumber) +
            "</span></div>" +
            '<div class="detail-layout"><div class="detail-main">' +
            '<section class="panel detail-banner">' +
            '<div class="detail-banner-top">' +
            '<span class="complaint-card-ref mono">' +
            escape(complaint.referenceNumber) +
            "</span>" +
            App.priorityBadge(complaint.priority) +
            App.statusBadge(complaint.status) +
            (complaint.isOverdue
                ? '<span class="badge badge-overdue">' +
                  icon("clock", "icon-xs") +
                  " " +
                  escape(t("complaint.overdue")) +
                  "</span>"
                : "") +
            (complaint.isAnonymous
                ? '<span class="badge" data-tone="neutral">' +
                  icon("eye-off", "icon-xs") +
                  " " +
                  escape(t("complaint.anonymousBadge")) +
                  "</span>"
                : "") +
            upvoteMarkup(complaint) +
            "</div><h1>" +
            escape(complaint.title) +
            '</h1><div class="detail-meta">' +
            statusMetaMarkup(complaint) +
            "</div></section>" +
            (complaint.isOverdue
                ? '<div class="alert-item is-danger"><span class="alert-icon">' +
                  icon("alert-triangle") +
                  '</span><div class="alert-copy"><strong>' +
                  escape(t("complaint.overdue")) +
                  "</strong><p>" +
                  escape(t("complaint.overdueNotice")) +
                  "</p></div></div>"
                : "") +
            '<section class="panel detail-section" aria-labelledby="descriptionTitle">' +
            '<h2 id="descriptionTitle">' +
            escape(t("complaint.descriptionTitle")) +
            '</h2><p class="prose">' +
            escape(complaint.description) +
            "</p>" +
            locationMarkup(complaint) +
            "</section>" +
            attachmentsMarkup() +
            resolution +
            rejection +
            feedbackPanelMarkup(complaint) +
            reopenPanelMarkup(complaint) +
            '<section class="panel detail-section" aria-labelledby="timelineTitle">' +
            '<h2 id="timelineTitle">' +
            escape(t("complaint.timelineTitle")) +
            '</h2><p class="field-hint">' +
            escape(t("complaint.timelineSubtitle")) +
            "</p>" +
            timelineMarkup() +
            "</section>" +
            '<section class="panel detail-section" aria-labelledby="conversationTitle">' +
            '<h2 id="conversationTitle">' +
            escape(t("complaint.conversationTitle")) +
            '</h2><p class="field-hint">' +
            escape(t("complaint.conversationSubtitle")) +
            "</p>" +
            commentListMarkup(publicNotes) +
            commentFormMarkup("public") +
            "</section>" +
            internalPanel +
            "</div>" +
            sidePanelMarkup(complaint) +
            "</div>";

        window.CampusFixShell.setPageTitle(complaint.referenceNumber, {
            literal: true
        });
    }

    async function load() {
        const token = ++state.loadToken;

        if (!state.complaint) {
            renderSkeleton();
        }

        try {
            const data = await App.api.get(
                "/complaints/details/" + encodeURIComponent(state.complaintId)
            );

            if (token !== state.loadToken) {
                return;
            }

            state.data = data;
            state.complaint = data.complaint;
            state.permissions = data.permissions || {};
            state.notes = Array.isArray(data.notes) ? data.notes : [];
            state.history = Array.isArray(data.history) ? data.history : [];
            state.attachments = Array.isArray(data.attachments)
                ? data.attachments
                : [];
            state.upvotes = data.upvotes || {
                count: data.complaint.upvoteCount || 0,
                hasUpvoted: false
            };
            state.rating = 0;
            renderPage();
        } catch (error) {
            if (token !== state.loadToken) {
                return;
            }

            if (error.status === 401) {
                window.location.replace(App.loginUrl());
                return;
            }

            if (error.status === 404) {
                renderNotFound();
                return;
            }

            if (error.status === 400 && !state.complaint) {
                renderNotFound();
                return;
            }

            if (error.status === 403) {
                renderError(App.friendlyError(error));
                return;
            }

            renderError(App.friendlyError(error, t("complaint.loadError")));
        }
    }

    function fieldInputFor(path) {
        return {
            status: elements.statusSelect,
            resolution: elements.statusResolution,
            rejectionReason: elements.statusRejection,
            note: elements.statusNote,
            departmentId: elements.assignmentDepartment,
            assignedToId: elements.assignmentAssignee
        }[path];
    }

    function applyStatusFieldVisibility() {
        const value = elements.statusSelect.value;

        elements.resolutionField.hidden = value !== "Resolved";
        elements.rejectionField.hidden = value !== "Rejected";
        elements.statusHint.hidden = Boolean(
            state.complaint && state.complaint.assignedTo
        );
        elements.statusSelect.setAttribute(
            "aria-describedby",
            elements.statusHint.hidden ? "" : "statusHint"
        );
    }

    function openStatusDialog() {
        if (!state.complaint || !state.permissions.canUpdateStatus) {
            return;
        }

        App.clearFieldErrors(elements.statusForm);
        elements.statusForm.reset();
        elements.statusResolution.value = "";
        elements.statusRejection.value = "";
        elements.statusNote.value = "";

        const allowed = TRANSITIONS[state.complaint.status] || [];
        let firstEnabled = "";
        const options = allowed.map((status) => {
            const disabled =
                status === "Assigned" && !state.complaint.assignedTo;

            if (!disabled && !firstEnabled) {
                firstEnabled = status;
            }

            return (
                '<option value="' +
                escape(status) +
                '"' +
                (disabled ? " disabled" : "") +
                (disabled
                    ? ' title="' + escape(t("error.assignment_required")) + '"'
                    : "") +
                ">" +
                escape(I18N.statusLabel(status)) +
                "</option>"
            );
        });

        elements.statusSelect.innerHTML = options.length
            ? options.join("")
            : '<option value="">' + escape(t("common.unknown")) + "</option>";
        elements.statusSelect.value = firstEnabled;
        elements.statusSubmit.disabled = !firstEnabled;
        applyStatusFieldVisibility();
        elements.statusDialog.showModal();
        window.setTimeout(() => elements.statusSelect.focus(), 40);
    }

    async function handleStatusSubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.statusForm);

        const status = elements.statusSelect.value;
        const resolution = elements.statusResolution.value.trim();
        const rejectionReason = elements.statusRejection.value.trim();
        const note = elements.statusNote.value.trim();
        const firstInvalid = { input: null };

        if (!status) {
            App.toast(t("error.invalid_status_transition"), "error");
            return;
        }

        if (status === "Resolved" && resolution.length < 3) {
            App.fieldError(elements.statusResolution, t("complaint.resolutionRequired"));
            firstInvalid.input = elements.statusResolution;
        }

        if (status === "Rejected" && rejectionReason.length < 3) {
            App.fieldError(
                elements.statusRejection,
                t("complaint.rejectionRequired")
            );
            firstInvalid.input = elements.statusRejection;
        }

        if (firstInvalid.input) {
            firstInvalid.input.focus();
            return;
        }

        const payload = { status };

        if (note) {
            payload.note = note;
        }

        if (status === "Resolved") {
            payload.resolution = resolution;
        }

        if (status === "Rejected") {
            payload.rejectionReason = rejectionReason;
        }

        const restore = App.buttonLoading(
            elements.statusSubmit,
            t("complaint.updating")
        );

        try {
            await App.api.put(
                "/admin/complaints/" +
                    encodeURIComponent(state.complaint.id) +
                    "/status",
                payload
            );
            elements.statusDialog.close();
            App.toast(t("complaint.statusUpdated"), "success");
            await load();
            window.CampusFixShell.refreshNotifications();
        } catch (error) {
            restore();

            let mapped = false;

            (error.errors || []).forEach((issue) => {
                const field = String(issue.path || "").split(".")[0];
                const input = fieldInputFor(field);

                if (input && input.closest("dialog") === elements.statusDialog) {
                    App.fieldError(input, issue.message || t("common.requiredField"));
                    mapped = true;
                }
            });

            if (!mapped) {
                App.toast(
                    App.friendlyError(error, t("complaint.loadError")),
                    "error",
                    7000
                );
            }
        }
    }

    function assignmentDepartmentOptions(departments) {
        const complaint = state.complaint;
        const manager = state.user.role === "department_manager";
        let rows = departments.filter(
            (department) =>
                department.isActive !== false ||
                department.id === complaint.department.id
        );

        if (manager) {
            rows = rows.filter(
                (department) => department.id === complaint.department.id
            );
        }

        if (rows.length === 0) {
            rows = [
                {
                    id: complaint.department.id,
                    name: complaint.department.name,
                    isActive: true
                }
            ];
        }

        return rows;
    }

    async function populateAssignees(departmentId, selectedId) {
        const token = ++state.assigneeToken;

        elements.assignmentAssignee.disabled = true;
        elements.assignmentSubmit.disabled = true;
        elements.assignmentAssignee.innerHTML =
            '<option value="">' +
            escape(t("common.loading")) +
            "</option>";

        try {
            const data = await App.api.get(
                "/admin/staff?departmentId=" + encodeURIComponent(departmentId)
            );

            if (token !== state.assigneeToken) {
                return;
            }

            const staff = (data.staff || []).filter(
                (member) =>
                    member.departmentId === departmentId &&
                    ["staff", "department_manager"].includes(member.role)
            );
            const options = [
                '<option value="">' +
                    escape(t("complaint.unassignedOption")) +
                    "</option>"
            ];

            staff.forEach((member) => {
                options.push(
                    '<option value="' +
                    escape(member.id) +
                    '">' +
                    escape(member.name) +
                    " — " +
                    escape(I18N.roleLabel(member.role)) +
                    "</option>"
                );
            });

            elements.assignmentAssignee.innerHTML = options.join("");
            elements.assignmentAssignee.disabled = false;

            if (selectedId && staff.some((member) => member.id === selectedId)) {
                elements.assignmentAssignee.value = selectedId;
            } else {
                elements.assignmentAssignee.value = "";
            }

            elements.assignmentSubmit.disabled = false;
        } catch (error) {
            if (token !== state.assigneeToken) {
                return;
            }

            elements.assignmentAssignee.innerHTML =
                '<option value="">' + escape(t("common.unknown")) + "</option>";
            App.toast(
                App.friendlyError(error, t("common.loadingError")),
                "error"
            );
        }
    }

    async function openAssignmentDialog() {
        if (!state.complaint || !state.permissions.canAssign) {
            return;
        }

        App.clearFieldErrors(elements.assignmentForm);
        elements.assignmentDepartment.disabled = true;
        elements.assignmentAssignee.disabled = true;
        elements.assignmentSubmit.disabled = true;
        elements.assignmentDepartment.innerHTML =
            '<option value="">' +
            escape(t("common.loading")) +
            "</option>";
        elements.assignmentAssignee.innerHTML =
            '<option value="">' +
            escape(t("common.loading")) +
            "</option>";
        elements.assignmentDialog.showModal();

        try {
            const data = await App.api.get("/admin/departments");
            const rows = assignmentDepartmentOptions(data.departments || []);

            elements.assignmentDepartment.innerHTML = rows
                .map(
                    (department) =>
                        '<option value="' +
                        escape(department.id) +
                        '">' +
                        escape(I18N.departmentLabel(department.name)) +
                        (department.isActive === false
                            ? " — " + escape(t("admin.inactive"))
                            : "") +
                        "</option>"
                )
                .join("");
            elements.assignmentDepartment.value =
                state.complaint.department.id;

            if (state.user.role !== "admin") {
                elements.assignmentDepartment.disabled = true;
            } else {
                elements.assignmentDepartment.disabled = false;
            }

            await populateAssignees(
                elements.assignmentDepartment.value,
                state.complaint.assignedTo
                    ? state.complaint.assignedTo.id
                    : ""
            );
        } catch (error) {
            elements.assignmentDialog.close();
            App.toast(
                App.friendlyError(error, t("common.loadingError")),
                "error",
                7000
            );
        }
    }

    async function handleAssignmentSubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.assignmentForm);

        const departmentId = elements.assignmentDepartment.value;

        if (!departmentId) {
            App.fieldError(
                elements.assignmentDepartment,
                t("common.requiredField")
            );
            elements.assignmentDepartment.focus();
            return;
        }

        const restore = App.buttonLoading(
            elements.assignmentSubmit,
            t("complaint.assigning")
        );

        try {
            await App.api.put(
                "/admin/complaints/" +
                    encodeURIComponent(state.complaint.id) +
                    "/assignment",
                {
                    departmentId,
                    assignedToId: elements.assignmentAssignee.value || null
                }
            );
            elements.assignmentDialog.close();
            App.toast(t("complaint.assigned"), "success");
            await load();
            window.CampusFixShell.refreshNotifications();
        } catch (error) {
            restore();

            let mapped = false;

            (error.errors || []).forEach((issue) => {
                const field = String(issue.path || "").split(".")[0];
                const input = fieldInputFor(field);

                if (input && input.closest("dialog") === elements.assignmentDialog) {
                    App.fieldError(input, issue.message || t("common.requiredField"));
                    mapped = true;
                }
            });

            if (!mapped) {
                App.toast(
                    App.friendlyError(error, t("common.loadingError")),
                    "error",
                    7000
                );
            }
        }
    }

    function openPriorityDialog() {
        if (!state.complaint || !state.permissions.canManage) {
            return;
        }

        App.clearFieldErrors(elements.priorityForm);
        const input = elements.priorityForm.querySelector(
            'input[name="priority"][value="' +
                state.complaint.priority +
                '"]'
        );

        if (input) {
            input.checked = true;
        }

        elements.priorityDialog.showModal();
        window.setTimeout(() => {
            const selected = elements.priorityForm.querySelector(
                'input[name="priority"]:checked'
            );

            if (selected) {
                selected.focus();
            }
        }, 40);
    }

    async function handlePrioritySubmit(event) {
        event.preventDefault();
        App.clearFieldErrors(elements.priorityForm);

        const selected = elements.priorityForm.querySelector(
            'input[name="priority"]:checked'
        );

        if (!selected) {
            App.toast(t("common.requiredField"), "error");
            return;
        }

        const restore = App.buttonLoading(
            elements.prioritySubmit,
            t("complaint.updating")
        );

        try {
            await App.api.put(
                "/admin/complaints/" +
                    encodeURIComponent(state.complaint.id) +
                    "/priority",
                { priority: selected.value }
            );
            elements.priorityDialog.close();
            App.toast(t("complaint.priorityUpdated"), "success");
            await load();
        } catch (error) {
            restore();
            App.toast(
                App.friendlyError(error, t("common.loadingError")),
                "error",
                7000
            );
        }
    }

    function setFeedbackStars(value) {
        state.rating = value;

        const form = elements.root.querySelector("[data-feedback-form]");

        if (!form) {
            return;
        }

        form.querySelectorAll("[data-feedback-star]").forEach((button) => {
            const star = Number(button.getAttribute("data-feedback-star"));
            const active = star <= value;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });

        const error = form.querySelector("#feedbackError");

        if (error) {
            error.textContent = "";
        }
    }

    async function handleFeedbackSubmit(form) {
        const error = form.querySelector("#feedbackError");

        if (!state.rating) {
            if (error) {
                error.textContent = t("complaint.ratingRequired");
            }

            const firstStar = form.querySelector("[data-feedback-star]");

            if (firstStar) {
                firstStar.focus();
            }

            return;
        }

        const comment = form.querySelector('[name="comment"]').value.trim();
        const button = form.querySelector('button[type="submit"]');
        const restore = App.buttonLoading(button, t("complaint.updating"));
        const payload = { rating: state.rating };

        if (comment) {
            payload.comment = comment;
        }

        try {
            await App.api.post(
                "/complaints/" +
                    encodeURIComponent(state.complaint.id) +
                    "/feedback",
                payload
            );
            App.toast(t("complaint.feedbackSaved"), "success");
            await load();
        } catch (requestError) {
            restore();
            App.toast(
                App.friendlyError(requestError, t("complaint.loadError")),
                "error",
                7000
            );
        }
    }

    async function handleReopenSubmit(form) {
        App.clearFieldErrors(form);

        const field = form.querySelector('[name="reason"]');
        const reason = field.value.trim();

        if (reason.length < 5) {
            App.fieldError(field, t("complaint.reopenMin"));
            field.focus();
            return;
        }

        const restore = App.buttonLoading(
            form.querySelector('button[type="submit"]'),
            t("complaint.reopening")
        );

        try {
            await App.api.post(
                "/complaints/" +
                    encodeURIComponent(state.complaint.id) +
                    "/reopen",
                { reason }
            );
            App.toast(t("complaint.reopened"), "success");
            await load();
            window.CampusFixShell.refreshNotifications();
        } catch (error) {
            restore();
            App.toast(
                App.friendlyError(error, t("complaint.loadError")),
                "error",
                7000
            );
        }
    }

    async function handleCommentSubmit(form) {
        App.clearFieldErrors(form);

        const field = form.querySelector('[name="message"]');
        const message = field.value.trim();
        const visibility = form.getAttribute("data-visibility");

        if (!message) {
            App.fieldError(field, t("complaint.commentRequired"));
            field.focus();
            return;
        }

        const restore = App.buttonLoading(
            form.querySelector('button[type="submit"]'),
            t("complaint.posting")
        );

        try {
            await App.api.post(
                "/complaints/" +
                    encodeURIComponent(state.complaint.id) +
                    "/comments",
                {
                    message,
                    visibility: visibility === "internal" ? "internal" : "public"
                }
            );
            App.toast(t("complaint.commentPosted"), "success");
            await load();
        } catch (error) {
            restore();
            App.toast(
                App.friendlyError(error, t("complaint.loadError")),
                "error",
                7000
            );
        }
    }

    async function copyReference() {
        if (!state.complaint) {
            return;
        }

        const copied = await App.copyText(state.complaint.referenceNumber);
        App.toast(
            copied ? t("common.copied") : t("common.errorBody"),
            copied ? "success" : "error"
        );
    }

    async function deleteComplaint() {
        if (!state.complaint || state.user.role !== "admin") {
            return;
        }

        const confirmed = await App.confirm({
            title: t("complaint.deleteTitle"),
            message: t("complaint.deleteBody"),
            confirmLabel: t("complaint.deleteConfirm"),
            tone: "danger"
        });

        if (!confirmed) {
            return;
        }

        try {
            await App.api.del(
                "/admin/complaints/" + encodeURIComponent(state.complaint.id)
            );
            App.toast(t("complaint.deleted"), "success");
            window.location.replace(App.homeFor(state.user));
        } catch (error) {
            App.toast(
                App.friendlyError(error, t("common.errorBody")),
                "error",
                7000
            );
        }
    }

    function bindDialogEvents() {
        document.querySelectorAll("[data-close-dialog]").forEach((button) => {
            button.addEventListener("click", () => {
                const dialog = button.closest("dialog");

                if (dialog) {
                    dialog.close();
                }
            });
        });

        [
            elements.statusDialog,
            elements.assignmentDialog,
            elements.priorityDialog
        ].forEach((dialog) => {
            dialog.addEventListener("click", (event) => {
                if (event.target === dialog) {
                    dialog.close();
                }
            });
        });

        elements.statusSelect.addEventListener(
            "change",
            applyStatusFieldVisibility
        );
        elements.statusForm.addEventListener("submit", handleStatusSubmit);
        elements.assignmentForm.addEventListener(
            "submit",
            handleAssignmentSubmit
        );
        elements.priorityForm.addEventListener(
            "submit",
            handlePrioritySubmit
        );
        elements.assignmentDepartment.addEventListener("change", () => {
            populateAssignees(elements.assignmentDepartment.value, "");
        });
    }

    async function handleUpvote(button) {
        const restore = App.buttonLoading(
            button,
            t("complaint.upvoting")
        );

        try {
            const data = await App.api.post(
                "/complaints/" +
                    encodeURIComponent(state.complaintId) +
                    "/upvote"
            );

            state.upvotes = data.upvotes || {
                count: 0,
                hasUpvoted: false
            };
            state.complaint.upvoteCount = state.upvotes.count;
            renderPage();
            App.toast(data.message || t("complaint.upvoteUpdated"));
        } catch (error) {
            restore();
            App.toast(
                App.friendlyError(
                    error,
                    t("complaint.upvoteError")
                ),
                "error"
            );
        }
    }

    async function removeAttachment(attachmentId) {
        const attachment = state.attachments.find(
            (item) => item.id === attachmentId
        );
        const confirmed = await App.confirm({
            title: t("complaint.photoRemoveTitle"),
            message: t("complaint.photoRemoveBody"),
            confirmLabel: t("complaint.photoRemoveConfirm")
        });

        if (!confirmed) {
            return;
        }

        try {
            await App.api.del(
                "/complaints/" +
                    encodeURIComponent(state.complaintId) +
                    "/attachments/" +
                    encodeURIComponent(attachmentId)
            );
            App.toast(
                t("complaint.photoRemoved", {
                    name: attachment ? attachment.fileName : ""
                }),
                "success"
            );
            await load();
        } catch (error) {
            App.toast(
                App.friendlyError(
                    error,
                    t("complaint.photoRemoveError")
                ),
                "error"
            );
        }
    }

    function bindRootEvents() {
        elements.root.addEventListener("click", (event) => {
            const star = event.target.closest("[data-feedback-star]");

            if (star) {
                setFeedbackStars(Number(star.getAttribute("data-feedback-star")));
                return;
            }

            if (event.target.closest("[data-retry-detail]")) {
                load();
                return;
            }

            if (event.target.closest("#updateStatusButton")) {
                openStatusDialog();
                return;
            }

            if (event.target.closest("#assignButton")) {
                openAssignmentDialog();
                return;
            }

            if (event.target.closest("#changePriorityButton")) {
                openPriorityDialog();
                return;
            }

            if (event.target.closest("#copyReferenceButton")) {
                copyReference();
                return;
            }

            if (event.target.closest("#deleteComplaintButton")) {
                deleteComplaint();
                return;
            }

            if (event.target.closest("#upvoteButton")) {
                handleUpvote(event.target.closest("#upvoteButton"));
                return;
            }

            const removeButton = event.target.closest(
                "[data-remove-attachment]"
            );

            if (removeButton) {
                removeAttachment(
                    removeButton.getAttribute(
                        "data-remove-attachment"
                    )
                );
            }
        });

        elements.root.addEventListener("submit", (event) => {
            if (event.target.matches("[data-feedback-form]")) {
                event.preventDefault();
                handleFeedbackSubmit(event.target);
                return;
            }

            if (event.target.matches("[data-reopen-form]")) {
                event.preventDefault();
                handleReopenSubmit(event.target);
                return;
            }

            if (event.target.matches("[data-comment-form]")) {
                event.preventDefault();
                handleCommentSubmit(event.target);
            }
        });
    }

    async function init() {
        const user = await window.CampusFixShell.ready;

        if (!user) {
            return;
        }

        state.user = user;

        window.CampusFixShell.setActiveNav(
            user.role === "student" ? "nav.dashboard" : "nav.complaints"
        );

        bindDialogEvents();
        bindRootEvents();

        if (!state.complaintId) {
            renderNotFound();
            return;
        }

        await load();

        window.addEventListener("campusfix:languagechange", () => {
            [
                elements.statusDialog,
                elements.assignmentDialog,
                elements.priorityDialog
            ].forEach((dialog) => {
                if (dialog.open) {
                    dialog.close();
                }
            });

            if (state.complaint) {
                renderPage();
            } else {
                renderSkeleton();
            }
        });
    }

    init();
})();
