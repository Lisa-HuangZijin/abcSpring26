// from: https://dev.to/li/how-to-requestpermission-for-devicemotion-and-deviceorientation-events-in-ios-13-46g2
// function requestOrientation() {
//     // feature detect
//     if (typeof DeviceOrientationEvent.requestPermission === 'function') {
//         DeviceOrientationEvent.requestPermission()
//         .then(permissionState => {
//             if (permissionState === 'granted') {
//             window.addEventListener('deviceorientation', handleOrientation, true);
//             }
//         })
//         .catch(console.error);
//     } else {
//         // handle regular non iOS 13+ devices
//     }
// }

document.addEventListener(
  "click",
  function () {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      DeviceOrientationEvent.requestPermission()
        .then((permissionState) => {
          if (permissionState === "granted") {
            window.addEventListener("deviceorientation", handleOrientation);
          }
        })
        .catch(console.error);
    } else {
      window.addEventListener("deviceorientation", handleOrientation);
    }
  },
  { once: true },
);
