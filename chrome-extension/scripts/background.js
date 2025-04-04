chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension Installed");
});

// Flag to ensure that backend finishes processing data before allowing another request.
let isProcessing = false; 

// Listen for message from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "scrape") {
		console.log("Message received in background.js:", message);
		handleScrapeRequest(sendResponse);
		
		// Tells Chrome to wait for sendResponse so the 'message port' does not close automatically
		return true;
	}
});

/**
 * Handles the scraping for popup.js
 * @param {*} sendResponse 
 * @returns 
 */
async function handleScrapeRequest(sendResponse) {
	// If backend is current processing a request, then stop execution.
	if (isProcessing) {
		// NOTE: Does not give a warning message to user
		console.warn("Processing request. Please wait.");
		return sendResponse({ success: false, message: "Processing request. Please wait."});
	} 

	isProcessing = true; // Prevent further requests

	try {
		const tab = await getActiveTab();
		if (!isSupportedWebsite(tab.url)) {
			throw new Error("This extension is not supported on this website.");
		}
		await injectContentScript(tab.id); // Inject the content script before sending a message
		
		const response = await sendScrapeMessage(tab.id) // Send message to scrape to content.js
		// Bad response from content.js
		if (!response) { 
			throw new Error("Could not retrieve product data. Please try again."); 
		}
		sendResponse({ success: true, data: response.productData});

		// Send data to backend
		await sendDataToBackend(response.productData); // Will throw error if something goes wrong
		console.log("Data successfully sent to backend.");
	} catch(error) {
		sendError(error.message);
		sendResponse({ success: false, message: error.message });
	} finally {
		isProcessing = false; // Reset after processing
	}
}

/**
 * Gets the current active tab.
 * @returns {Promise<Tab>}
 */
function getActiveTab() {

	return new Promise((resolve, reject) => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (!tabs.length) {
				return reject(new Error("No active tab found.")); // Return to stop further execution
			}
			resolve(tabs[0]);
		});
	});
}

/**
 * Injects a content script into a tab.
 * @param {number} tabId 
 * @returns {Promise<void>}
 */
function injectContentScript(tabId) {
	return new Promise((resolve, reject) => {
		chrome.scripting.executeScript({
			target: { tabId: tabId }, // The tab where the script is injected
			files: ["scripts/content.js"] // The script being injected
		}, () => {
			if (chrome.runtime.lastError) {
				return reject(new Error("Failed to inject content script.")); // Return to stop further execution
			}
			resolve();
			console.log("Content script injected successfully.");
		});
	});
}

/**
 * Send a scrape message to the content script.
 * @param {number} tabId 
 * @returns {Promise<object>}
 */
function sendScrapeMessage(tabId) {
	return new Promise((resolve) => {
		chrome.tabs.sendMessage(tabId, { action: "scrape" }, (response) => resolve(response));
	});
}

/**
 * Sends data to backend.
 * @param {object} productData 
 * @returns {Promise<object>}
 */
async function sendDataToBackend(productData) {
	const url = "http://localhost:5000/receive-data"; // Set to local host
	try {
		console.log("Sending data to backend...", productData)
		// Asynchronous request to backend
		const response = await fetch(url, {
			method: "POST",
			headers: {"Content-type": "application/json"}, // Set content type to JSON
			body: JSON.stringify(productData)
		});

		if(!response.ok) {
			throw new Error(`Failed to send data ${response.statusText}`);
		}

		return await response.json(); // Return the response from backend
	} catch(error) {
		console.error("Error sending data to backend: ", error);
		throw error // Throw the error for handling by the caller 
	}
}

/**
 * Checks if the website is supported by the extension.
 * @param {string} url 
 * @returns {boolean}
 */
function isSupportedWebsite(url) {
	const supportedWebsites = ["amazon.com"]
	try {
		const parsedURL = new URL(url);
		return supportedWebsites.some(domain => parsedURL.hostname.endsWith(domain));
	} catch {
		return false; // Invalid urls
	}
}

/**
 * Sends a chrome notification telling the user something went wrong.
 * @param {string} message 
 */
function notifyUser(message) {
	chrome.notifications.create({
		type: "basic",
		iconUrl: chrome.runtime.getURL("images/icon.png"),
		title: "Error encountered :(",
		message: message,
		priority: 2
	});
}

/**
 * Logs an error, notifies a user, and resets the isProcessing flag
 * @param {string} message 
 */
function sendError(message) {
	console.error(message);
	notifyUser(message);
	if (isProcessing) isProcessing = false;  // Allow requests again if there is an ongoing request
}




