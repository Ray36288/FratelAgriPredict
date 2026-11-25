/* =========================================================
   AGRIPREDICT - MAIN JAVASCRIPT
   Homepage, Authentication and Farmer Dashboard
========================================================= */

(function () {
    "use strict";

    /* =====================================================
       1. MAIN INITIALIZATION
    ===================================================== */
   

    let initialized = false;

    function startAgriPredict() {
        if (initialized) return;
        initialized = true;

        console.log("AgriPredict: Initializing...");

        safelyInitialize("Slideshow", initializeSlideshow);
        safelyInitialize("Statistics", initializeStatistics);
        safelyInitialize("Footer", initializeFooter);
        safelyInitialize("Navigation", initializeNavigation);
        safelyInitialize("Authentication", initializeAuth);
        safelyInitialize("Dashboard", initializeDashboard);

        console.log("AgriPredict: Initialization complete.");
    }

    function safelyInitialize(name, callback) {
        try {
            const result = callback();

            if (result instanceof Promise) {
                result.catch(error => {
                    console.error(
                        `AgriPredict ${name} initialization failed:`,
                        error
                    );
                });
            }
        } catch (error) {
            console.error(
                `AgriPredict ${name} initialization failed:`,
                error
            );
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            startAgriPredict,
            { once: true }
        );
    } else {
        startAgriPredict();
    }


    /* =====================================================
       2. SUPABASE CONNECTION
    ===================================================== */

    function getSupabase() {
        if (!window.supabaseClient) {
            console.error(
                "AgriPredict: Supabase client is unavailable. " +
                "Check supabase-config.js."
            );

            return null;
        }

        return window.supabaseClient;
    }


    /* =====================================================
       3. HOMEPAGE SLIDESHOW
    ===================================================== */

    function initializeSlideshow() {
        const slides = document.querySelectorAll(".slide");

        if (!slides.length) return;

        const dotsContainer =
            document.getElementById("sliderDots");

        const nextButton =
            document.getElementById("nextSlide") ||
            document.querySelector(".next-slide, .slider-btn.next");

        const previousButton =
            document.getElementById("prevSlide") ||
            document.querySelector(".prev-slide, .slider-btn.prev");

        let currentSlide = 0;
        let slideshowTimer = null;

        const dots = [];

        if (dotsContainer) {
            dotsContainer.innerHTML = "";

            slides.forEach((slide, index) => {
                const dot = document.createElement("button");

                dot.type = "button";
                dot.className = "slide-dot";

                dot.setAttribute(
                    "aria-label",
                    `Show picture ${index + 1}`
                );

                dot.addEventListener("click", () => {
                    showSlide(index);
                    startSlideshow();
                });

                dotsContainer.appendChild(dot);
                dots.push(dot);
            });
        } else {
            dots.push(
                ...document.querySelectorAll(".slide-dot")
            );
        }

        function showSlide(index) {
            currentSlide =
                (index + slides.length) % slides.length;

            slides.forEach((slide, i) => {
                slide.classList.toggle(
                    "active",
                    i === currentSlide
                );
            });

            dots.forEach((dot, i) => {
                dot.classList.toggle(
                    "active",
                    i === currentSlide
                );
            });
        }

        function startSlideshow() {
            clearInterval(slideshowTimer);

            slideshowTimer = setInterval(() => {
                showSlide(currentSlide + 1);
            }, 5000);
        }

        nextButton?.addEventListener("click", () => {
            showSlide(currentSlide + 1);
            startSlideshow();
        });

        previousButton?.addEventListener("click", () => {
            showSlide(currentSlide - 1);
            startSlideshow();
        });

        showSlide(0);
        startSlideshow();
    }


    /* =====================================================
       4. HOMEPAGE STATISTICS
    ===================================================== */

    function initializeStatistics() {
        const counters = document.querySelectorAll(
            "[data-counter], [data-count]"
        );

        if (!counters.length) return;

        if (!("IntersectionObserver" in window)) return;

        const observer = new IntersectionObserver(
            (entries, obs) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;

                    const counter = entry.target;

                    const target = Number(
                        counter.dataset.counter ??
                        counter.dataset.count
                    );

                    if (!Number.isFinite(target)) {
                        obs.unobserve(counter);
                        return;
                    }

                    const duration = 1200;
                    const startTime = performance.now();

                    function updateCounter(currentTime) {
                        const progress = Math.min(
                            (currentTime - startTime) / duration,
                            1
                        );

                        counter.textContent = Math.floor(
                            target * progress
                        ).toLocaleString();

                        if (progress < 1) {
                            requestAnimationFrame(updateCounter);
                        }
                    }

                    requestAnimationFrame(updateCounter);
                    obs.unobserve(counter);
                });
            }
        );

        counters.forEach(counter => observer.observe(counter));
    }


    /* =====================================================
       5. FOOTER YEAR
    ===================================================== */

    function initializeFooter() {
        const year = new Date().getFullYear();

        setText("currentYear", year);
        setText("authYear", year);
        setText("dashboardYear", year);
    }


    /* =====================================================
       6. GENERAL NAVIGATION
    ===================================================== */

    function initializeNavigation() {
        const menuButton = document.querySelector(".menu-toggle");

        const navigation = document.querySelector(
            ".main-navigation, .main-nav"
        );

        if (!menuButton || !navigation) return;

        menuButton.addEventListener("click", () => {
            const isOpen =
                navigation.classList.toggle("active");

            menuButton.classList.toggle("active", isOpen);

            menuButton.setAttribute(
                "aria-expanded",
                String(isOpen)
            );
        });

        navigation.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                navigation.classList.remove("active");
                menuButton.classList.remove("active");

                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );
            });
        });
    }


    /* =====================================================
       7. AUTHENTICATION
    ===================================================== */

    function initializeAuth() {
        const loginForm =
            document.getElementById("loginForm");

        const registerForm =
            document.getElementById("registerForm");

        if (!loginForm && !registerForm) return;

        const supabase = getSupabase();
        if (!supabase) return;

        const authMessage =
            document.getElementById("authMessage");

        const loginTab =
            document.getElementById("loginTab");

        const registerTab =
            document.getElementById("registerTab");

        const showRegisterButton =
            document.getElementById("showRegister");

        const showLoginButton =
            document.getElementById("showLogin");

        const resendButton =
            document.getElementById("resendConfirmation");

        let loginInProgress = false;
        let registrationInProgress = false;

        function showAuthMessage(message, type = "error") {
            if (!authMessage) {
                console.warn(message);
                return;
            }

            authMessage.textContent = message;
            authMessage.className = `auth-message ${type}`;
            authMessage.style.display = "block";
        }

        function clearAuthMessage() {
            if (authMessage) {
                authMessage.textContent = "";
                authMessage.style.display = "none";
            }
        }

        /*
         * Actual auth.html uses loginForm/registerForm
         * and loginTab/registerTab.
         *
         * It does not use loginPanel/registerPanel.
         */

        function activateAuthTab(selectedTab) {
            const showLogin = selectedTab !== "register";

            if (loginForm) {
                loginForm.hidden = !showLogin;
                loginForm.style.display = showLogin ? "" : "none";
            }

            if (registerForm) {
                registerForm.hidden = showLogin;
                registerForm.style.display = showLogin ? "none" : "";
            }

            loginTab?.classList.toggle("active", showLogin);
            registerTab?.classList.toggle("active", !showLogin);

            loginTab?.setAttribute(
                "aria-selected",
                String(showLogin)
            );

            registerTab?.setAttribute(
                "aria-selected",
                String(!showLogin)
            );

            clearAuthMessage();
        }

        loginTab?.addEventListener("click", event => {
            event.preventDefault();
            activateAuthTab("login");
        });

        registerTab?.addEventListener("click", event => {
            event.preventDefault();
            activateAuthTab("register");
        });

        showRegisterButton?.addEventListener("click", event => {
            event.preventDefault();
            activateAuthTab("register");
        });

        showLoginButton?.addEventListener("click", event => {
            event.preventDefault();
            activateAuthTab("login");
        });

        const urlParams = new URLSearchParams(
            window.location.search
        );

        activateAuthTab(
            urlParams.get("mode") === "register"
                ? "register"
                : "login"
        );


        /* -------------------------------------------------
           REGISTRATION
        ------------------------------------------------- */

        registerForm?.addEventListener("submit", async event => {
            event.preventDefault();

            if (registrationInProgress) return;

            const fullName = getValue("fullName");
            const username = getValue("registerUsername");
            const email = getValue("registerEmail");
            const phone = getValue("phoneNumber");
            const password = getValue("registerPassword");
            const confirmPassword = getValue("confirmPassword");

            const termsCheckbox =
                document.getElementById("acceptTerms");

            if (
                !fullName ||
                !username ||
                !email ||
                !password ||
                !confirmPassword
            ) {
                showAuthMessage(
                    "Please complete all required fields."
                );
                return;
            }

            if (!/^[a-zA-Z0-9_]{3,25}$/.test(username)) {
                showAuthMessage(
                    "Username must be 3–25 characters and contain only letters, numbers or underscores."
                );
                return;
            }

            if (password.length < 8) {
                showAuthMessage(
                    "Your password must contain at least 8 characters."
                );
                return;
            }

            if (password !== confirmPassword) {
                showAuthMessage(
                    "Your passwords do not match."
                );
                return;
            }

            if (termsCheckbox && !termsCheckbox.checked) {
                showAuthMessage(
                    "Please accept the terms before creating an account."
                );
                return;
            }

            const button = registerForm.querySelector(
                'button[type="submit"]'
            );

            registrationInProgress = true;

            setButtonLoading(
                button,
                true,
                "Creating account..."
            );

            try {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo:
                            ,

                        data: {
                            full_name: fullName,
                            username,
                            phone
                        }
                    }
                });

                if (error) throw error;

                showAuthMessage(
                    "Account created. Check your email and confirm your account before logging in.",
                    "success"
                );

                registerForm.reset();

            } catch (error) {
                console.error("Registration error:", error);

                showAuthMessage(
                    getErrorMessage(
                        error,
                        "Unable to create your account."
                    )
                );

            } finally {
                registrationInProgress = false;

                setButtonLoading(button, false);
            }
        });


        /* -------------------------------------------------
           RESEND CONFIRMATION EMAIL
        ------------------------------------------------- */

        resendButton?.addEventListener("click", async () => {
            const email = getValue("registerEmail");

            if (!email) {
                showAuthMessage(
                    "Enter your email address first."
                );
                return;
            }

            const originalText =
                resendButton.dataset.originalText ||
                resendButton.textContent;

            setButtonLoading(
                resendButton,
                true,
                "Sending..."
            );

            try {
                const { error } = await supabase.auth.resend({
                    type: "signup",
                    email,
                    options: {
                        emailRedirectTo:
                            new URL("auth.html", window.location.href).toString()
                    }
                });

                if (error) throw error;

                showAuthMessage(
                    "A new confirmation email has been sent.",
                    "success"
                );

            } catch (error) {
                console.error(
                    "Resend confirmation error:",
                    error
                );

                showAuthMessage(
                    getErrorMessage(
                        error,
                        "Unable to resend confirmation email."
                    )
                );

            } finally {
                setButtonLoading(
                    resendButton,
                    false,
                    originalText
                );
            }
        });


        /* -------------------------------------------------
           LOGIN
        ------------------------------------------------- */

        loginForm?.addEventListener("submit", async event => {
            event.preventDefault();

            if (loginInProgress) return;

            const username = getValue("loginUsername");
            const password = getValue("loginPassword");

            if (!username || !password) {
                showAuthMessage(
                    "Enter your username and password."
                );
                return;
            }

            const button = loginForm.querySelector(
                'button[type="submit"]'
            );

            loginInProgress = true;

            setButtonLoading(
                button,
                true,
                "Signing in..."
            );

            /*
             * Prevent a request from leaving the login button
             * loading forever.
             */

            const controller = new AbortController();

            const timeout = setTimeout(() => {
                controller.abort();
            }, 20000);

            try {
                const { data, error } =
                    await supabase.functions.invoke(
                        "username-login",
                        {
                            body: {
                                username,
                                password
                            },
                            signal: controller.signal
                        }
                    );

                if (error) {
                    throw error;
                }

                const session = data?.session || data;

                if (
                    !session?.access_token ||
                    !session?.refresh_token
                ) {
                    throw new Error(
                        data?.error ||
                        "The login service did not return a valid session."
                    );
                }

                const { error: sessionError } =
                    await supabase.auth.setSession({
                        access_token: session.access_token,
                        refresh_token: session.refresh_token
                    });

                if (sessionError) {
                    throw sessionError;
                }

                sessionStorage.setItem(
                    "agriUsername",
                    username
                );

                window.location.replace("dashboard.html");

            } catch (error) {
                console.error("Login error:", error);

                if (error.name === "AbortError") {
                    showAuthMessage(
                        "The login request timed out. Check your internet connection and try again."
                    );
                } else {
                    showAuthMessage(
                        getErrorMessage(
                            error,
                            "Unable to sign in. Check your username and password."
                        )
                    );
                }

            } finally {
                clearTimeout(timeout);

                loginInProgress = false;

                setButtonLoading(button, false);
            }
        });
    }


    /* =====================================================
       8. FARMER DASHBOARD INITIALIZATION
    ===================================================== */

    async function initializeDashboard() {
        const dashboard = document.querySelector(
            ".dashboard-page"
        );

        if (!dashboard) return;

        // Navigation and the local farm-data bridge should remain useful even
        // when account/Supabase configuration is temporarily unavailable.
        initializeDashboardClock();
        initializeDashboardNavigation();
        initializeLogout();

        const supabase = getSupabase();
        if (!supabase) {
            window.AgriPredictFarmPortfolio?.render();
            showDashboardMessage(
                "Farm records can be viewed locally, but account and project enrolment services are unavailable. Check supabase-config.js."
            );
            return;
        }

        try {
            const {
                data: sessionData,
                error: sessionError
            } = await supabase.auth.getSession();

            if (sessionError) throw sessionError;

            if (!sessionData?.session) {
                window.location.replace("auth.html");
                return;
            }

            const user = sessionData.session.user;
            console.log("Dashboard auth user ID:", user.id);

            const validFarmer = await loadFarmerProfile(
                supabase,
                user
            );

            if (!validFarmer) return;

            await loadFarmerProjects(
                supabase,
                user.id
            );

            initializeProfilePictureUpload(
                supabase,
                user
            );

        } catch (error) {
            console.error(
                "Dashboard initialization error:",
                error
            );

            showDashboardMessage(
                "Unable to initialize your dashboard. Please refresh the page."
            );
        }
    }


    /* =====================================================
       9. DASHBOARD CLOCK
    ===================================================== */

    function initializeDashboardClock() {
        const dateElement =
            document.getElementById("dashboardDate");

        const clockElement =
            document.getElementById("dashboardClock");

        if (!dateElement && !clockElement) return;

        function updateClock() {
            const now = new Date();

            if (dateElement) {
                dateElement.textContent =
                    new Intl.DateTimeFormat("en-UG", {
                        timeZone: "Africa/Kampala",
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric"
                    }).format(now);
            }

            if (clockElement) {
                clockElement.textContent =
                    new Intl.DateTimeFormat("en-UG", {
                        timeZone: "Africa/Kampala",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        hour12: true
                    }).format(now);
            }
        }

        updateClock();

        setInterval(updateClock, 1000);
    }


    /* =====================================================
       10. DASHBOARD SIDEBAR NAVIGATION
    ===================================================== */

    function initializeDashboardNavigation() {
        const sidebar =
            document.getElementById("dashboardSidebar");

        const toggleButton =
            document.getElementById("sidebarToggle");

        const closeButton =
            document.querySelector(".sidebar-close");

        const overlay =
            document.getElementById("sidebarOverlay");

        const links = document.querySelectorAll(
            ".sidebar-link"
        );

        const sections = document.querySelectorAll(
            ".dashboard-section"
        );

        function closeSidebar() {
            sidebar?.classList.remove("active");
            overlay?.classList.remove("active");
        }

        function openSidebar() {
            sidebar?.classList.add("active");
            overlay?.classList.add("active");
        }

        toggleButton?.addEventListener("click", () => {
            if (sidebar?.classList.contains("active")) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });

        closeButton?.addEventListener("click", closeSidebar);
        overlay?.addEventListener("click", closeSidebar);

        function activateSection(sectionId) {
            if (!sectionId) return;

            const target = document.getElementById(sectionId);

            if (!target) {
                console.warn(
                    "Dashboard section not found:",
                    sectionId
                );
                return;
            }

            sections.forEach(section => {
                section.classList.remove("active-section");
            });

            target.classList.add("active-section");

            links.forEach(link => {
                const linkTarget = link
                    .getAttribute("href")
                    ?.replace("#", "");

                link.classList.toggle(
                    "active",
                    linkTarget === sectionId
                );
            });

            closeSidebar();

            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        }

        links.forEach(link => {
            link.addEventListener("click", event => {
                const href = link.getAttribute("href");

                if (!href?.startsWith("#")) return;

                const sectionId = href.substring(1);

                if (!document.getElementById(sectionId)) {
                    return;
                }

                event.preventDefault();

                activateSection(sectionId);

                history.replaceState(
                    null,
                    "",
                    `#${sectionId}`
                );
            });
        });

        document.querySelectorAll(
            "[data-dashboard-section]"
        ).forEach(button => {
            button.addEventListener("click", () => {
                const sectionId =
                    button.dataset.dashboardSection;

                activateSection(sectionId);

                history.replaceState(
                    null,
                    "",
                    `#${sectionId}`
                );
            });
        });

        const initialSection =
            window.location.hash.replace("#", "") ||
            "overview";

        activateSection(initialSection);
    }


       /* =====================================================
       11. LOAD FARMER PROFILE
    ===================================================== */

    async function loadFarmerProfile(supabase, user) {
        const { data: profile, error } = await supabase
            .from("profiles")
            .select(
                "full_name, username, email, phone, avatar_url, role, account_status"
            )
            .eq("id", user.id)
            .single();

        if (error) {
            console.error("Profile loading error:", error);

            showDashboardMessage(
                "Unable to load your profile. Check that your profile record exists."
            );

            return false;
        }

        // Verify the administrator's secured role.
        const { data: securedRole, error: roleError } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .maybeSingle();

        if (roleError) {
            console.error("Role verification error:", roleError);

            showDashboardMessage(
                "Unable to verify your account permissions."
            );

            return false;
        }

        // Send administrators to their separate dashboard.
        if (
            profile.role === "admin" &&
            securedRole?.role === "admin" &&
            profile.account_status === "active"
        ) {
            window.location.replace(
                new URL(
                    "admin-dashboard.html",
                    window.location.href
                ).toString()
            );

            return false;
        }

        // Only active farmer accounts can use this dashboard.
        if (
            profile.role !== "farmer" ||
            profile.account_status !== "active"
        ) {
            alert("This dashboard is for active farmer accounts.");

            await supabase.auth.signOut();

            window.location.replace(
                new URL("auth.html", window.location.href).toString()
            );

            return false;
        }

        const fullName = profile.full_name || "Farmer";
        const username = profile.username || "";
        const email = profile.email || user.email || "";
        const phone = profile.phone || "";

        setText("welcomeUsername", fullName);
        setText("sidebarUsername", fullName);

        setText("profileFullName", fullName);
        setText("profileUsername", username);
        setText("profileEmail", email);
        setText("profilePhone", phone);

        const initial = fullName.charAt(0).toUpperCase();

        setText("sidebarAvatarInitial", initial);
        setText("topbarAvatarInitial", initial);
        setText("profileAvatarInitial", initial);

        if (profile.avatar_url) {
            setProfileImages(profile.avatar_url);
        }

        return true;
    }
    /* =====================================================
       12. LOAD FARMER PROJECTS
    ===================================================== */

    async function loadFarmerProjects(supabase, farmerId) {
        const {
            data: projects,
            error: projectError
        } = await supabase
            .from("projects")
            .select("*")
            .eq("is_active", true)
            .order("name");

        if (projectError) {
            console.error(
                "Project catalogue error:",
                projectError
            );

            showDashboardMessage(
                "Unable to load available projects."
            );

            return;
        }

        const {
            data: enrollments,
            error: enrollmentError
        } = await supabase
            .from("project_enrollments")
            .select(`
                id,
                project_id,
                enrolled_at,
                projects (
                    id,
                    name,
                    slug,
                    category,
                    description,
                    features,
                    image_url
                )
            `)
            .eq("farmer_id", farmerId);

        if (enrollmentError) {
            console.error(
                "Enrollment loading error:",
                enrollmentError
            );

            showDashboardMessage(
                "Unable to load your enrolled projects."
            );

            return;
        }

        const enrolledProjects = (enrollments || [])
            .map(item => item.projects)
            .filter(Boolean);

        updateProjectCount(enrolledProjects.length);

        renderProjectCatalogue(
            projects || [],
            enrollments || []
        );

        renderMyProjects(enrolledProjects);

        renderDashboardProjectSummary(enrolledProjects);

        // Connect enrolled project context to the read-only whole-farm
        // portfolio module. This does not write or alter any farm records.
        window.AgriPredictFarmPortfolio?.setProjects(
            enrolledProjects,
            enrollments || []
        );
    }


    /* =====================================================
       13. renPROJECT COUNT
    ===================================================== */

    function updateProjectCount(count) {
        setText("myProjectsCount", count);
    }


    /* =====================================================
       14. PROJECT BUTTON CONFIGURATION
    ===================================================== */

    const PROJECT_CONTROLS = {
        broiler: {
            button: "enrollBroiler",
            status: "broilerStatus"
        },

        "broiler-farming": {
            button: "enrollBroiler",
            status: "broilerStatus"
        },

        croiler: {
            button: "enrollCroiler",
            status: "croilerStatus"
        },

        "croiler-farming": {
            button: "enrollCroiler",
            status: "croilerStatus"
        },

        layers: {
            button: "enrollLayers",
            status: "layersStatus"
        },

        layer: {
            button: "enrollLayers",
            status: "layersStatus"
        },

        "layer-farming": {
            button: "enrollLayers",
            status: "layersStatus"
        },

        piggery: {
            button: "enrollPiggery",
            status: "piggeryStatus"
        },

        "fish-farming": {
            button: "enrollFish",
            status: "fishStatus"
        },

        "crop-farming": {
            button: "enrollCrops",
            status: "cropsStatus"
        },

        dairy: {
            button: "enrollDairy",
            status: "dairyStatus"
        },

        "dairy-farming": {
            button: "enrollDairy",
            status: "dairyStatus"
        }
    };


    /* =====================================================
       15. DISPLAY AVAILABLE PROJECTS
    ===================================================== */

    function renderProjectCatalogue(projects, enrollments) {
        const enrolledIds = new Set(
            enrollments.map(item => item.project_id)
        );

        projects.forEach(project => {
            const slug = project.slug?.toLowerCase();

            const controls = PROJECT_CONTROLS[slug];

            if (!controls) return;

            const button = document.getElementById(
                controls.button
            );

            const status = document.getElementById(
                controls.status
            );

            if (!button) {
                console.warn(
                    "Project enrollment button not found:",
                    controls.button
                );
                return;
            }

            const isEnrolled = enrolledIds.has(project.id);

            button.disabled = isEnrolled;

            button.textContent = isEnrolled
                ? "Already Enrolled"
                : "Enroll Now";

            if (status) {
                status.textContent = isEnrolled
                    ? "Enrolled"
                    : "Available";
            }

            button.onclick = null;

            if (!isEnrolled) {
                button.onclick = () => {
                    enrollInProject(project);
                };
            }
        });
    }


    /* =====================================================
       16. ENROLL IN A PROJECT
    ===================================================== */

    async function enrollInProject(project) {
        const supabase = getSupabase();

        if (!supabase) return;

        if (!project?.id || !project?.name) {
            alert("Invalid project information.");
            return;
        }

        try {
            const {
                data: sessionData,
                error: sessionError
            } = await supabase.auth.getSession();

            if (sessionError) throw sessionError;

            const user = sessionData?.session?.user;

            if (!user) {
                window.location.href = "auth.html";
                return;
            }

            const confirmed = confirm(
                `Enroll in ${project.name}?\n\n` +
                "You will be able to manage this farming project from My Projects."
            );

            if (!confirmed) return;

            const controls = PROJECT_CONTROLS[
                project.slug?.toLowerCase()
            ];

            const button = controls
                ? document.getElementById(controls.button)
                : null;

            if (button?.disabled) return;

            setButtonLoading(
                button,
                true,
                "Enrolling..."
            );

            const { error } = await supabase
                .from("project_enrollments")
                .insert({
                    farmer_id: user.id,
                    project_id: project.id
                });

            if (error) throw error;

            alert(
                `You have successfully enrolled in ${project.name}.`
            );

            await loadFarmerProjects(
                supabase,
                user.id
            );

        } catch (error) {
            console.error("Enrollment error:", error);

            alert(
                getErrorMessage(
                    error,
                    "Unable to enroll in this project."
                )
            );

            const controls = PROJECT_CONTROLS[
                project.slug?.toLowerCase()
            ];

            const button = controls
                ? document.getElementById(controls.button)
                : null;

            setButtonLoading(button, false, "Enroll Now");
        }
    }




    /* =====================================================
       FARM PROJECT VISUALS
       Local images keep enrolled-project cards useful even
       when the project catalogue has no image_url set.
    ===================================================== */

    function projectVisual(project) {
        const slug = String(project?.slug || project?.name || "").toLowerCase();
        let key = "crops";
        let icon = "🌱";
        if (slug.includes("broiler")) { key = "broiler"; icon = "🐤"; }
        else if (slug.includes("croiler")) { key = "croiler"; icon = "🐔"; }
        else if (slug.includes("layer")) { key = "layers"; icon = "🥚"; }
        else if (slug.includes("pig")) { key = "piggery"; icon = "🐖"; }
        else if (slug.includes("dairy") || slug.includes("cattle") || slug.includes("cow")) { key = "dairy"; icon = "🐄"; }
        else if (slug.includes("fish")) { key = "fish"; icon = "🐟"; }
        else if (slug.includes("crop")) { key = "crops"; icon = "🌾"; }

        const supplied = String(project?.image_url || "").trim();
        const safeSupplied = /^(https?:\/\/|\/|images\/)/i.test(supplied) ? supplied : "";
        return {
            src: safeSupplied || `images/${key}.webp`,
            fallback: `images/${key}.webp`,
            icon
        };
    }

    function bindProjectImageFallback(container) {
        container.querySelectorAll("img.project-photo").forEach(image => {
            image.addEventListener("error", () => {
                if (image.dataset.fallbackApplied !== "true") {
                    image.dataset.fallbackApplied = "true";
                    image.src = image.dataset.fallback || "images/crops.jpg";
                } else {
                    image.hidden = true;
                    image.parentElement?.classList.add("project-image-missing");
                }
            }, { once: false });
        });
    }

    /* =====================================================
       17. DISPLAY MY PROJECTS
    ===================================================== */

    function renderMyProjects(projects) {
        const section = document.getElementById("myProjects");

        if (!section) return;

        let container = section.querySelector(
            "#myProjectsContainer, .my-projects-container"
        );

        if (!container) {
            container = document.createElement("div");
            container.id = "myProjectsContainer";
            container.className = "my-projects-container";

            section.appendChild(container);
        }

        container.innerHTML = "";

        if (!projects.length) {
            container.innerHTML = `
                <div class="dashboard-panel empty-state">
                    <div class="empty-state-icon">🌱</div>

                    <h3>You have not enrolled in a project yet</h3>

                    <p>
                        Explore the available agricultural projects
                        and choose the enterprises you want to manage.
                    </p>

                    <button
                        type="button"
                        class="primary-action"
                        data-dashboard-section="availableProjects">
                        Explore Projects
                    </button>
                </div>
            `;

            container.querySelector("button")
                ?.addEventListener("click", () => {
                    document.querySelector(
                        '.sidebar-link[href="#availableProjects"]'
                    )?.click();
                });

            return;
        }

        projects.forEach(project => {
            const card = document.createElement("article");

            card.className = "agri-project-card";

            const visual = projectVisual(project);

            card.innerHTML = `
                <div class="project-image project-image-enrolled">
                    <img class="project-photo"
                        src="${escapeHTML(visual.src)}"
                        data-fallback="${escapeHTML(visual.fallback)}"
                        alt="${escapeHTML(project.name)} farming project"
                        loading="lazy">
                    <span class="project-image-symbol" aria-hidden="true">${visual.icon}</span>
                    <span class="project-image-state">ENROLLED</span>
                </div>

                <div class="project-card-content">
                    <span class="project-category">
                        ${escapeHTML(
                            project.category || "Agriculture"
                        )}
                    </span>

                    <h3>
                        ${escapeHTML(project.name)}
                    </h3>

                    <p>
                        ${escapeHTML(
                            project.description ||
                            "Manage your farming enterprise."
                        )}
                    </p>

                    <div class="project-card-footer">
                        <span class="enrollment-status">
                            Active project
                        </span>

                        <button
                            type="button"
                            class="project-enroll-button open-project-button">
                            Open Project
                        </button>
                    </div>
                </div>
            `;

            card.querySelector(
                ".open-project-button"
            )?.addEventListener("click", () => {
                openFarmerProject(project);
            });

            container.appendChild(card);
            bindProjectImageFallback(card);
        });
    }


    /* =====================================================
       18. OPEN FARMER PROJECT
    ===================================================== */

function openFarmerProject(project) {
    const normalise = value =>
        String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[\s_]+/g, "-");

    const slug = normalise(
        typeof project === "string" ? project : project?.slug
    );

    const name = normalise(
        typeof project === "string" ? project : project?.name
    );

    let destination;

    // Check both the database slug and project name.
    if ([slug, name].some(value => value.includes("layer"))) {
        destination = "layers-dashboard.html";
    } else {
        const routes = {
            broiler: "broiler-dashboard.html",
            "broiler-farming": "broiler-dashboard.html",
            croiler: "poultry-dashboard.html",
            "croiler-farming": "poultry-dashboard.html",
            poultry: "poultry-dashboard.html"
        };

        destination = routes[slug] || routes[name];
    }

    if (!destination) {
        alert("No dashboard is configured for this project.");
        return;
    }

    window.location.href =
        new URL(destination, window.location.href).toString();
}
    /* =====================================================
       19. DASHBOARD PROJECT SUMMARY
    ===================================================== */

    function renderDashboardProjectSummary(projects) {
        const container = document.getElementById(
            "dashboardProjectSummary"
        );

        if (!container) return;

        container.innerHTML = "";

        if (!projects.length) {
            container.innerHTML = `
                <div class="empty-state compact-empty">
                    <div class="empty-state-icon">🌱</div>

                    <h4>No active projects</h4>

                    <p>
                        Enroll in a project to start managing your farm.
                    </p>
                </div>
            `;

            return;
        }

        projects.slice(0, 4).forEach(project => {
            const item = document.createElement("div");

            item.className = "project-summary-item";

            const visual = projectVisual(project);
            item.innerHTML = `
                <img class="project-summary-photo project-photo"
                    src="${escapeHTML(visual.src)}"
                    data-fallback="${escapeHTML(visual.fallback)}"
                    alt="" loading="lazy">
                <div class="project-summary-copy">
                    <strong>${escapeHTML(project.name)}</strong>
                    <span>Enrolled project</span>
                </div>
                <span class="enrollment-status">Active</span>
            `;

            container.appendChild(item);
            bindProjectImageFallback(item);
        });
    }


    /* =====================================================
       20. DASHBOARD MESSAGES
    ===================================================== */

    function showDashboardMessage(message) {
        console.warn("AgriPredict:", message);

        const container = document.getElementById(
            "dashboardMessage"
        );

        if (container) {
            container.textContent = message;
            container.style.display = "block";
        }
    }


    /* =====================================================
       21. PROFILE PICTURE UPLOAD
    ===================================================== */

    function initializeProfilePictureUpload(supabase, user) {
        const uploadInput = document.getElementById(
            "profilePictureUpload"
        );

        if (!uploadInput) return;

        uploadInput.addEventListener("change", async () => {
            const file = uploadInput.files?.[0];

            if (!file) return;

            if (!file.type.startsWith("image/")) {
                alert("Please select an image file.");
                uploadInput.value = "";
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                alert(
                    "Your profile picture must be smaller than 5 MB."
                );

                uploadInput.value = "";
                return;
            }

            const extension = file.name
                .split(".")
                .pop()
                .toLowerCase();

            const filePath =
                `${user.id}/profile-${Date.now()}.${extension}`;

            try {
                const { error: uploadError } =
                    await supabase.storage
                        .from("profile-pictures")
                        .upload(filePath, file, {
                            cacheControl: "3600",
                            upsert: true
                        });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } =
                    supabase.storage
                        .from("profile-pictures")
                        .getPublicUrl(filePath);

                const avatarUrl = publicUrlData.publicUrl;

                const { error: updateError } =
                    await supabase
                        .from("profiles")
                        .update({
                            avatar_url: avatarUrl
                        })
                        .eq("id", user.id);

                if (updateError) throw updateError;

                setProfileImages(avatarUrl);

                alert(
                    "Your profile picture has been updated."
                );

            } catch (error) {
                console.error(
                    "Profile picture upload error:",
                    error
                );

                alert(
                    getErrorMessage(
                        error,
                        "Unable to upload your profile picture. Check your storage setup."
                    )
                );

            } finally {
                uploadInput.value = "";
            }
        });
    }


    /* =====================================================
       22. UPDATE PROFILE IMAGES
    ===================================================== */

    function setProfileImages(imageUrl) {
        const imageIds = [
            "sidebarProfileImage",
            "topbarProfileImage",
            "profileImage"
        ];

        imageIds.forEach(id => {
            const image = document.getElementById(id);

            if (image) {
                image.src = imageUrl;
                image.style.display = "block";
            }
        });

        const initialIds = [
            "sidebarAvatarInitial",
            "topbarAvatarInitial",
            "profileAvatarInitial"
        ];

        initialIds.forEach(id => {
            const initial = document.getElementById(id);

            if (initial) {
                initial.style.display = "none";
            }
        });
    }


    /* =====================================================
       23. LOGOUT
    ===================================================== */

    function initializeLogout() {
        const logoutButton = document.getElementById(
            "logoutButton"
        );

        if (!logoutButton) return;

        logoutButton.addEventListener("click", async () => {
            const confirmed = confirm(
                "Are you sure you want to log out?"
            );

            if (!confirmed) return;

            const supabase = getSupabase();
            if (!supabase) return;

            setButtonLoading(
                logoutButton,
                true,
                "Logging out..."
            );

            try {
                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                sessionStorage.removeItem("agriUsername");

                window.location.replace("auth.html");

            } catch (error) {
                console.error("Logout error:", error);

                alert(
                    getErrorMessage(
                        error,
                        "Unable to log out. Please try again."
                    )
                );

                setButtonLoading(logoutButton, false);
            }
        });
    }


    /* =====================================================
       24. BUTTON LOADING
    ===================================================== */

    function setButtonLoading(button, loading, loadingText) {
        if (!button) return;

        if (loading) {
            if (!button.dataset.originalText) {
                button.dataset.originalText =
                    button.textContent;
            }

            button.disabled = true;

            button.textContent =
                loadingText || "Please wait...";

        } else {
            button.disabled = false;

            const originalText =
                button.dataset.originalText;

            button.textContent =
                loadingText ||
                originalText ||
                "Submit";

            delete button.dataset.originalText;
        }
    }


    /* =====================================================
       25. GENERAL HELPER FUNCTIONS
    ===================================================== */

    function getValue(elementId) {
        return document
            .getElementById(elementId)
            ?.value.trim() || "";
    }

    function setText(elementId, value) {
        const element = document.getElementById(elementId);

        if (element) {
            element.textContent = value ?? "";
        }
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(
            /[&<>"']/g,
            character => {
                const characters = {
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;"
                };

                return characters[character];
            }
        );
    }

    function getErrorMessage(error, fallback) {
        if (error?.name === "AbortError") {
            return "The request timed out. Please try again.";
        }

        return error?.message || fallback;
    }

})();

