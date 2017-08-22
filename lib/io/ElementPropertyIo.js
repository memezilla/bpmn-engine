'use strict';

module.exports = function ActivityIO(activity, parentContext) {
  const id = activity.id;
  const type = `io:${activity.$type}`;
  const environment = parentContext.environment;

  let resultData;

  return {
    id,
    type,
    getInput,
    getOutput,
    save,
    setOutputValue,
    setResult
  };

  function getInput(message) {
    return message;
  }

  function getOutput() {
    return resultData;
  }

  function setOutputValue(name, value) {
    resultData = resultData || {};
    resultData[name] = value;
  }

  function save() {
    environment.assignResult(resultData);
  }

  function setResult(value) {
    resultData = value;
  }
};