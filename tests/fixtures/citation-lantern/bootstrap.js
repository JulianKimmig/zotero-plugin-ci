/** Minimal restartless second-plugin entrypoints; native behavior is unverified. */
/** Install without changing persistent state. @param {object} data Addon metadata. @param {number} reason Native reason. @returns {void} */
function install(data, reason) {}
/** Start without changing persistent state. @param {object} data Addon metadata. @param {number} reason Native reason. @returns {void} */
function startup(data, reason) {}
/** Stop without changing persistent state. @param {object} data Addon metadata. @param {number} reason Native reason. @returns {void} */
function shutdown(data, reason) {}
/** Uninstall without changing persistent state. @param {object} data Addon metadata. @param {number} reason Native reason. @returns {void} */
function uninstall(data, reason) {}
