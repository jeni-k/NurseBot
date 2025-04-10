import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = "AIzaSyADWvBxj7ZQDVh2wGYEGu1n9_AbfbvagkM";
const genAI = new GoogleGenerativeAI(API_KEY);

const healthInstruction = `
You are an AI Health Assistant. Provide suggestions on diet, exercise, and doctor visits based on user queries. If given drug names (from RxNorm API), incorporate them into your advice. Always add: "I am not a doctor. Consult a healthcare professional for medical advice. Mention the references which you used to give the answer. Also, if images are uploaded, analyze and predict any potential diseases (e.g., skin conditions, lung issues) to the best of your ability, and summarize findings with a TL;DR."
`;

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: healthInstruction
});

let messages = { history: [] };
let stopResponse = false;
let isGenerating = false;

async function fetchRxNormData(drugName) {
    const url = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drugName)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.idGroup && data.idGroup.rxnormId) {
        const rxcui = data.idGroup.rxnormId[0];
        const detailUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/properties.json`;
        const detailResponse = await fetch(detailUrl);
        const detailData = await detailResponse.json();
        return detailData.properties;
    }
    return null;
}

async function sendMessage() {
    const userMessage = document.querySelector(".chat-window input").value.trim();
    const imageInput = document.querySelector("#image-upload").files[0];

    if ((userMessage || imageInput) && !document.querySelector(".chat-window .loader")) {
        document.querySelector(".chat-window input").value = "";
        document.querySelector(".stop-btn").classList.add("active");

        if (userMessage) {
            document.querySelector(".chat-window .chat").insertAdjacentHTML("beforeend", `<div class="user"><p>${userMessage}</p></div>`);
            scrollChatSmoothly();
        }

        if (imageInput) {
            const reader = new FileReader();
            reader.onload = (e) => {
                document.querySelector(".chat-window .chat").insertAdjacentHTML("beforeend", `<div class="user"><img src="${e.target.result}" style="max-width: 200px;"></div>`);
                scrollChatSmoothly();
            };
            reader.readAsDataURL(imageInput);
        }

        document.querySelector(".chat-window .chat").insertAdjacentHTML("beforeend", `<div class="loader"></div>`);
        scrollChatSmoothly();
        isGenerating = true;

        try {
            let prompt = userMessage || "General health advice";
            let refs = [];

            // Drug check
            const drugMatch = userMessage.match(/(?:prescribed|taking|medication) (\w+)/i);
            let rxNormData = null;
            if (drugMatch) {
                const drugName = drugMatch[1].toLowerCase();
                rxNormData = await fetchRxNormData(drugName);
                if (rxNormData) {
                    prompt += `\nDrug: ${rxNormData.name}, Status: ${rxNormData.status}`;
                    refs.push(`RxNorm: https://rxnav.nlm.nih.gov/REST/rxcui/${rxNormData.rxcui}/properties.json`);
                    if (drugName === "aspirin") {
                        refs.push(`Mayo Clinic - Aspirin Use: https://www.mayoclinic.org/diseases-conditions/heart-disease/in-depth/daily-aspirin-therapy/art-20046797`);
                        refs.push(`USPSTF - Aspirin for CVD Prevention: https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/aspirin-use-to-prevent-cardiovascular-disease-preventive-medication`);
                    }
                }
            }

            // Image analysis
            let imageAnalysis = null;
            if (imageInput) {
                const mimeType = imageInput.type;
                const base64Image = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result.split(",")[1]);
                    reader.readAsDataURL(imageInput);
                });
                const chat = model.startChat(messages);
                const result = await chat.sendMessage([{ text: "Analyze this image for potential diseases (e.g., skin, lungs) briefly.", inlineData: { data: base64Image, mimeType } }]);
                imageAnalysis = result.response.text();
                if (imageAnalysis) {
                    prompt += `\nImage: ${imageAnalysis}`;
                    refs.push("Gemini Image Analysis");
                }
            }

            // Contextual references based on prompt keywords
            const keywords = userMessage.toLowerCase().match(/(vitamin k|exercise|doctor visits)/g);
            if (keywords) {
                if (keywords.includes("vitamin k")) {
                    refs.push(`WebMD - Vitamin K: https://www.webmd.com/diet/supplement-guide-vitamin-k`);
                    refs.push(`Harvard Health - Vitamin K and Heart Disease: https://www.health.harvard.edu/heart-health/diets-rich-in-vitamin-k-linked-to-lower-heart-disease-risk`);
                }
                if (keywords.includes("exercise")) {
                    refs.push(`Mayo Clinic - Exercise for Health: https://www.mayoclinic.org/healthy-lifestyle/fitness/basics/exercise-and-chronic-disease/art-20046049`);
                }
                if (keywords.includes("doctor visits")) {
                    refs.push(`NIH - Health Checkups: https://www.nih.gov/health-information`);
                }
            }

            // Get response
            const finalChat = model.startChat(messages);
            const finalResult = await finalChat.sendMessage(prompt);
            document.querySelector(".chat-window .chat").insertAdjacentHTML("beforeend", `<div class="model"><p></p></div>`);
            let latestMessage = document.querySelector(".chat-window .chat div.model:last-child p");
            let response = finalResult.response.text();

            // Clean ** markers and highlight topics
            response = response.replace(/\*\*/g, "");
            response = response.replace(/(Diet:|Exercise:|Doctor Visits:)/g, "<b>$1</b>");

            // Short TL;DR
            const tldrChat = model.startChat(messages);
            const tldrResult = await tldrChat.sendMessage(`Summarize in one sentence: ${response}`);
            let tldr = tldrResult.response.text();

            // Format output with dynamic references
            latestMessage.innerHTML = `${response}\n\nTL;DR: ${tldr}\n\nI am not a doctor. Consult a healthcare professional.\n\nReferences:\n- ${refs.length ? refs.join("\n- ") : "None"}`;
            messages.history.push({ role: "user", parts: [{ text: userMessage || "Image uploaded" }] });
            messages.history.push({ role: "model", parts: [{ text: latestMessage.innerHTML }] });

        } catch (error) {
            document.querySelector(".chat-window .chat").insertAdjacentHTML("beforeend", `<div class="error"><p>Error: ${error.message}</p></div>`);
        }

        document.querySelector(".chat-window .chat .loader").remove();
        isGenerating = false;
        document.querySelector(".stop-btn").classList.remove("active");
        scrollChatSmoothly();
    }
}

// Updated smooth auto-scroll function
function scrollChatSmoothly() {
    const chatContainer = document.querySelector(".chat-window .chat");
    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
    if (isNearBottom) {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
    }
}

// Updated function to handle scrolling during response
function scrollChatSmoothlyDuringResponse() {
    const chatContainer = document.querySelector(".chat-window .chat");
    const distanceFromBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    const maxScrollDistance = chatContainer.scrollHeight - chatContainer.clientHeight;

    if (distanceFromBottom < 100 && chatContainer.scrollTop < maxScrollDistance / 2) {
        chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
    }
}

// Stop button functionality
document.querySelector(".stop-btn").addEventListener("click", () => {
    if (isGenerating) {
        stopResponse = true;
    }
});

// Box click handlers (placeholder for API calls)
document.querySelector('#lungs-check').addEventListener('click', () => {
    console.log('Lungs Check API call triggered - implement API here');
    // Add your lungs API call logic later
});

document.querySelector('#skin-cancer-check').addEventListener('click', () => {
    console.log('Skin Cancer Detection API call triggered - implement API here');
    // Add your skin cancer API call logic later
});

// Keyboard event listeners
document.querySelector(".chat-window input").addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        const input = document.querySelector(".chat-window input");
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.substring(0, start) + "\n" + input.value.substring(end);
        input.selectionStart = input.selectionEnd = start + 1;
    }
});

document.querySelector(".send-btn").addEventListener("click", () => sendMessage());
document.querySelector(".chat-button").addEventListener("click", () => {
    document.querySelector("body").classList.add("chat-open");
});
document.querySelector(".chat-window .close").addEventListener("click", () => {
    document.querySelector("body").classList.remove("chat-open");
});

// Initial scroll check
const chatContainer = document.querySelector(".chat-window .chat");
chatContainer.addEventListener("scroll", scrollChatSmoothly);