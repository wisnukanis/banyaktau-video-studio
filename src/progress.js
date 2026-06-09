let currentProgress = {
  active: false,
  itemId: "",
  percent: 0,
  stage: "",
  message: "",
  error: ""
};

export function getProgress() {
  return currentProgress;
}

export function setProgress(update = {}) {
  currentProgress = {
    ...currentProgress,
    ...update
  };
}

export function resetProgress() {
  currentProgress = {
    active: false,
    itemId: "",
    percent: 0,
    stage: "",
    message: "",
    error: ""
  };
}
