/* ============================================================
   FRATEL-AGRIPREDICT
   Authentication JavaScript
   File: auth.js
   Supabase JavaScript SDK v2
   ============================================================ */

"use strict";

/* ============================================================
   1. SUPABASE CONFIGURATION
   ============================================================ */

const authClient = window.supabaseClient;

// Change this if your dashboard has a different filename.
const AUTH_REDIRECT_URL = "dashboard.html";

if (!authClient) {
    console.error("Supabase client was not initialized.");

    alert(
        "Authentication could not start. Check supabase-config.js."
    );

    throw new Error("Supabase client is missing.");
}


/* ============================================================
   2. HTML ELEMENTS
   ============================================================ */

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const recoveryForm = document.getElementById("recoveryForm");

const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");

const authTabs = document.querySelector(".auth-tabs");

const heading = document.getElementById("heading");
const subheading = document.getElementById("subheading");
const authMessage = document.getElementById("authMessage");

const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const recoveryButton = document.getElementById("recoveryButton");

const authContainer = document.querySelector(".auth-container");
const authFooter = document.querySelector(".auth-footer");


/* ============================================================
   3. PASSWORD RESET FORM
   ============================================================ */

const resetForm = document.createElement("form");

resetForm.id = "resetForm";
resetForm.className = "auth-form";
resetForm.hidden = true;

resetForm.innerHTML = `
    <div class="form-group">
        <label for="newPassword">New password</label>

        <div class="password-wrapper">
            <input
                type="password"
                id="newPassword"
                minlength="8"
                autocomplete="new-password"
                placeholder="Enter your new password"
                required
            >

            <button
                type="button"
                class="password-toggle"
                data-toggle="newPassword"
            >
                Show
            </button>
        </div>
    </div>

    <div class="form-group">
        <label for="confirmNewPassword">
            Confirm new password
        </label>

        <input
            type="password"
            id="confirmNewPassword"
            minlength="8"
            autocomplete="new-password"
            placeholder="Enter your new password again"
            required
        >
    </div>

    <button
        type="submit"
        class="primary-button"
        id="resetButton"
    >
        Update password
    </button>
`;

if (authContainer && authFooter) {
    authContainer.insertBefore(resetForm, authFooter);
}


/* ============================================================
   4. INITIALISE AUTHENTICATION
   ============================================================ */

document.addEventListener("DOMContentLoaded", initialiseAuth);

function initialiseAuth() {
    const year = document.getElementById("year");

    if (year) {
        year.textContent = new Date().getFullYear();
    }

    setupNavigation();
    setupPasswordToggles();
    setupLogin();
    setupRegistration();
    setupPasswordRecovery();
    setupPasswordReset();
    handleAuthState();

    checkExistingSession();
}


/* ============================================================
   5. CHECK EXISTING SESSION
   ============================================================ */

async function checkExistingSession() {
    try {
        const { data, error } =
            await authClient.auth.getSession();

        if (error) throw error;

        if (!data.session) return;

        // GetSession confirms the browser has an active local session.
        // Redirect only after the session is present; avoid signing out
        // because of an additional network validation request.
        window.location.replace(AUTH_REDIRECT_URL);

    } catch (error) {
        console.error("Session check failed:", error);

        try {
            await authClient.auth.signOut({ scope: "local" });
        } catch (signOutError) {
            console.error("Could not clear invalid session:", signOutError);
        }
    }
}


/* ============================================================
   6. MESSAGE HANDLING
   ============================================================ */

function showMessage(message, type = "success") {
    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.className = `message ${type}`;
    authMessage.hidden = false;

    authMessage.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

function clearMessage() {
    if (!authMessage) return;

    authMessage.textContent = "";
    authMessage.hidden = true;
    authMessage.className = "message";
}


/* ============================================================
   7. BUTTON LOADING
   ============================================================ */

function setButtonLoading(
    button,
    loading,
    loadingText = "Please wait..."
) {
    if (!button) return;

    if (loading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText =
                button.textContent.trim();
        }

        button.textContent = loadingText;
        button.disabled = true;

    } else {
        button.textContent =
            button.dataset.originalText || button.textContent;

        button.disabled = false;
    }
}


/* ============================================================
   8. SWITCH AUTHENTICATION VIEWS
   ============================================================ */

function showView(view) {
    clearMessage();

    loginForm.hidden = view !== "login";
    registerForm.hidden = view !== "register";
    recoveryForm.hidden = view !== "recovery";
    resetForm.hidden = view !== "reset";

    if (authTabs) {
        authTabs.hidden =
            !["login", "register"].includes(view);
    }

    loginTab.classList.toggle("active", view === "login");
    registerTab.classList.toggle("active", view === "register");

    switch (view) {
        case "login":
            heading.textContent = "Welcome back";
            subheading.textContent =
                "Sign in to continue to your account.";
            break;

        case "register":
            heading.textContent = "Create your account";
            subheading.textContent =
                "Join Fratel-AgriPredict and manage your farm smarter.";
            break;

        case "recovery":
            heading.textContent = "Reset your password";
            subheading.textContent =
                "We'll help you regain access to your account.";
            break;

        case "reset":
            heading.textContent = "Create a new password";
            subheading.textContent =
                "Choose a new password for your account.";
            break;
    }
}


/* ============================================================
   9. NAVIGATION
   ============================================================ */

function setupNavigation() {
    loginTab.addEventListener("click", () => {
        showView("login");
    });

    registerTab.addEventListener("click", () => {
        showView("register");
    });

    document.getElementById("goRegister").addEventListener(
        "click",
        () => showView("register")
    );

    document.getElementById("goLogin").addEventListener(
        "click",
        () => showView("login")
    );

    document.getElementById("forgotLink").addEventListener(
        "click",
        () => showView("recovery")
    );

    document.getElementById("backToLogin").addEventListener(
        "click",
        () => showView("login")
    );
}


/* ============================================================
   10. PASSWORD VISIBILITY
   ============================================================ */

function setupPasswordToggles() {
    document.querySelectorAll("[data-toggle]").forEach(button => {
        button.addEventListener("click", () => {
            const input = document.getElementById(
                button.dataset.toggle
            );

            if (!input) return;

            const isPassword = input.type === "password";

            input.type = isPassword ? "text" : "password";
            button.textContent = isPassword ? "Hide" : "Show";
        });
    });
}


/* ============================================================
   11. LOGIN
   ============================================================ */

function setupLogin() {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        clearMessage();

        if (!loginForm.reportValidity()) return;

        const email = document.getElementById("loginEmail")
            .value.trim();

        const password = document.getElementById("loginPassword")
            .value;

        setButtonLoading(loginButton, true, "Signing in...");

        try {
            const { data, error } =
                await authClient.auth.signInWithPassword({
                    email,
                    password
                });

            if (error) throw error;

            if (!data.session) {
                throw new Error(
                    "Login completed without an active session."
                );
            }

            showMessage(
                "Login successful! Opening your dashboard...",
                "success"
            );

            setButtonLoading(loginButton, false);

            // Redirect to the farmer dashboard.
            window.location.replace(AUTH_REDIRECT_URL);

        } catch (error) {
            console.error("Login error:", error);

            showMessage(
                getFriendlyError(error),
                "error"
            );

            setButtonLoading(loginButton, false);
        }
    });
}


/* ============================================================
   12. PHONE NUMBER FORMATTING
   ============================================================ */

function formatPhoneNumber(countryCode, phoneInput) {
    let digits = phoneInput.replace(/\D/g, "");

    if (digits.startsWith("0")) {
        digits = digits.substring(1);
    }

    if (!digits) {
        throw new Error("Please enter your phone number.");
    }

    const internationalNumber = `${countryCode}${digits}`;

    if (!/^\+[1-9]\d{7,14}$/.test(internationalNumber)) {
        throw new Error(
            "Please enter a valid international phone number."
        );
    }

    return internationalNumber;
}


/* ============================================================
   13. REGISTRATION
   ============================================================ */

function setupRegistration() {
    registerForm.addEventListener("submit", async event => {
        event.preventDefault();
        clearMessage();

        if (!registerForm.reportValidity()) return;

        const fullName = document.getElementById("fullName")
            .value.trim();

        const username = document.getElementById("username")
            .value.trim().toLowerCase();

        const email = document.getElementById("registerEmail")
            .value.trim();

        const countryCode = document.getElementById("countryCode")
            .value;

        const phoneInput = document.getElementById("phone")
            .value.trim();

        const password = document.getElementById("registerPassword")
            .value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;

        const acceptedTerms =
            document.getElementById("acceptTerms").checked;

        if (fullName.length < 2) {
            showMessage("Please enter your full name.", "error");
            return;
        }

        if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            showMessage(
                "Username must contain 3–30 letters, numbers or underscores.",
                "error"
            );
            return;
        }

        if (password.length < 8) {
            showMessage(
                "Your password must contain at least 8 characters.",
                "error"
            );
            return;
        }

        if (password !== confirmPassword) {
            showMessage(
                "Your passwords do not match.",
                "error"
            );
            return;
        }

        if (!acceptedTerms) {
            showMessage(
                "Please accept the terms and conditions.",
                "error"
            );
            return;
        }

        let phone;

        try {
            phone = formatPhoneNumber(countryCode, phoneInput);
        } catch (error) {
            showMessage(error.message, "error");
            return;
        }

        setButtonLoading(
            registerButton,
            true,
            "Creating account..."
        );

        try {
            const redirectUrl =
                `${window.location.origin}${window.location.pathname}`;

            const { data, error } =
                await authClient.auth.signUp({
                    email,
                    password,

                    options: {
                        emailRedirectTo: redirectUrl,

                        data: {
                            full_name: fullName,
                            username,
                            phone
                        }
                    }
                });

            if (error) throw error;

            if (data.session) {
                showMessage(
                    "Your account has been created successfully.",
                    "success"
                );

                window.location.replace(AUTH_REDIRECT_URL);

            } else {
                showMessage(
                    "Your account has been created. Check your email and confirm your address before signing in.",
                    "success"
                );

                registerForm.reset();

                setTimeout(() => {
                    showView("login");
                }, 4000);
            }

        } catch (error) {
            console.error("Registration error:", error);

            showMessage(
                getFriendlyError(error),
                "error"
            );

        } finally {
            setButtonLoading(registerButton, false);
        }
    });
}


/* ============================================================
   14. PASSWORD RECOVERY
   ============================================================ */

function setupPasswordRecovery() {
    recoveryForm.addEventListener("submit", async event => {
        event.preventDefault();
        clearMessage();

        if (!recoveryForm.reportValidity()) return;

        const email = document.getElementById("recoveryEmail")
            .value.trim();

        setButtonLoading(
            recoveryButton,
            true,
            "Sending link..."
        );

        try {
            const redirectUrl =
                `${window.location.origin}${window.location.pathname}`;

            const { error } =
                await authClient.auth.resetPasswordForEmail(
                    email,
                    {
                        redirectTo: redirectUrl
                    }
                );

            if (error) throw error;

            showMessage(
                "If an account exists for that email, a password reset link will be sent. Check your inbox.",
                "success"
            );

        } catch (error) {
            console.error("Password recovery error:", error);

            showMessage(
                getFriendlyError(error),
                "error"
            );

        } finally {
            setButtonLoading(recoveryButton, false);
        }
    });
}


/* ============================================================
   15. PASSWORD RESET
   ============================================================ */

function setupPasswordReset() {
    resetForm.addEventListener("submit", async event => {
        event.preventDefault();
        clearMessage();

        if (!resetForm.reportValidity()) return;

        const newPassword =
            document.getElementById("newPassword").value;

        const confirmNewPassword =
            document.getElementById("confirmNewPassword").value;

        if (newPassword.length < 8) {
            showMessage(
                "Your password must contain at least 8 characters.",
                "error"
            );
            return;
        }

        if (newPassword !== confirmNewPassword) {
            showMessage(
                "Your passwords do not match.",
                "error"
            );
            return;
        }

        const resetButton = document.getElementById("resetButton");

        setButtonLoading(
            resetButton,
            true,
            "Updating password..."
        );

        try {
            const { error } =
                await authClient.auth.updateUser({
                    password: newPassword
                });

            if (error) throw error;

            showMessage(
                "Your password has been updated successfully.",
                "success"
            );

            resetForm.reset();

            setTimeout(() => {
                showView("login");
            }, 2500);

        } catch (error) {
            console.error("Password update error:", error);

            showMessage(
                getFriendlyError(error),
                "error"
            );

        } finally {
            setButtonLoading(resetButton, false);
        }
    });
}


/* ============================================================
   16. AUTHENTICATION STATE
   ============================================================ */

function handleAuthState() {
    authClient.auth.onAuthStateChange((event, session) => {
        console.log("Authentication event:", event);

        if (event === "PASSWORD_RECOVERY") {
            showView("reset");

            showMessage(
                "Your recovery link is valid. Enter your new password.",
                "success"
            );
        }

        if (event === "SIGNED_IN" && session) {
            console.log("User session established.");
        }

        if (event === "SIGNED_OUT") {
            console.log("User signed out.");
        }
    });

    if (window.location.hash.includes("type=signup")) {
        showView("login");

        showMessage(
            "Your email confirmation has been processed. You can now sign in.",
            "success"
        );
    }
}


/* ============================================================
   17. FRIENDLY ERROR MESSAGES
   ============================================================ */

function getFriendlyError(error) {
    const message = (error?.message || "").toLowerCase();

    if (
        message.includes("invalid login credentials") ||
        message.includes("invalid email or password")
    ) {
        return "The email or password is incorrect. Please try again.";
    }

    if (message.includes("email not confirmed")) {
        return "Please confirm your email address before signing in.";
    }

    if (message.includes("user already registered")) {
        return "An account with this email address already exists.";
    }

    if (message.includes("password should be at least")) {
        return "Your password is too short. Use at least 8 characters.";
    }

    if (message.includes("rate limit")) {
        return "Too many attempts. Please wait before trying again.";
    }

    if (
        message.includes("network") ||
        message.includes("fetch")
    ) {
        return "A network error occurred. Check your internet connection.";
    }

    return error?.message ||
        "Something went wrong. Please try again.";
}
