'use strict';

const ActivityExecution = require('../activities/activity-execution');
const Debug = require('debug');
const TaskLoop = require('./task-loop');

module.exports = function TaskActivity(task, execute, state) {
  const id = task.id;
  const type = task.type;
  const debug = Debug(`bpmn-engine:${type.toLowerCase()}`);
  const emit = (...args) => task.emit(...args);
  const environment = task.environment;
  const inbound = task.inbound;
  const outbound = task.outbound;
  const loop = task.loop;

  state = Object.assign(state || {}, {
    id,
    type
  });

  const activityApi = {
    id,
    type,
    inbound,
    outbound,
    loop,
    deactivate,
    execute,
    getApi,
    getState,
    resume,
    run
  };

  activate();

  return activityApi;

  function activate() {
    inbound.forEach((flow) => {
      flow.on('taken', onInboundTaken);
      flow.on('discarded', onInboundDiscarded);
    });
  }

  function deactivate() {
    inbound.forEach((flow) => {
      flow.removeListener('taken', onInboundTaken);
      flow.removeListener('discarded', onInboundDiscarded);
    });
  }

  function run(message, inboundFlow) {
    const executionContext = ActivityExecution(task, message, environment, inboundFlow);
    enter(executionContext);
    const completeFn = completeCallback(executionContext, environment);

    if (loop) return runLoop(executionContext, completeFn);

    emit('start', activityApi, executionContext);
    if (executionContext.isStopped()) {
      return;
    }
    execute(activityApi, executionContext, completeCallback(executionContext));

    return activityApi;
  }

  function resume() {
    const executionContext = ActivityExecution.resume(state, task, null, environment);

    if (!state.entered) return;

    enter(executionContext);
    const completeFn = completeCallback(executionContext, environment);

    if (loop) return runLoop(executionContext, completeFn);

    emit('start', activityApi, executionContext);
    if (executionContext.isStopped()) {
      return;
    }
    execute(activityApi, executionContext, completeCallback(executionContext));

    return activityApi;
  }

  function runLoop(executionContext, callback) {
    const taskLoop = TaskLoop(loop, executionContext, (...args) => {
      execute(activityApi, ...args);
    }, emitter);

    if (state.loop) {
      return taskLoop.resume(state, callback);
    }

    return taskLoop.execute(callback);

    function emitter(eventName, ...args) {
      switch (eventName) {
        case 'start':
          onIterationStart(eventName, ...args);
          break;
        case 'end':
          onIterationEnd(eventName, ...args);
          break;
      }
    }

    function onIterationStart(eventName, loopApi, loopExecution) {
      emit('start', activityApi, loopExecution);
    }

    function onIterationEnd(eventName, loopApi, loopExecution) {
      emit('end', activityApi, loopExecution);
    }
  }

  function enter(executionContext) {
    if (state.taken) state.taken = undefined;
    if (state.canceled) state.canceled = undefined;

    state.entered = true;
    debug(`<${id}> enter`);
    emit('enter', activityApi, executionContext);
  }

  function getState() {
    return Object.assign({}, state);
  }

  function onInboundTaken(inboundFlow) {
    run(null, inboundFlow);
  }

  function onInboundDiscarded(inboundFlow, rootFlow) {
    const activityExecution = ActivityExecution(task, null, environment, inboundFlow, rootFlow);
    enter(activityExecution);
    discardAllOutbound(activityExecution, rootFlow);
  }

  function discardAllOutbound(executionContext, rootFlow) {
    if (outbound) outbound.forEach((flow) => flow.discard(rootFlow));
    state.entered = undefined;
    emit('leave', activityApi, executionContext);
  }

  function completeCallback(executionContext) {
    return callback;

    function callback(err, ...args) {
      state.entered = undefined;

      if (err) return emit('error', err, activityApi, executionContext);

      executionContext.setResult(...args);

      complete(executionContext);
    }
  }

  function complete(executionContext) {
    state.entered = undefined;
    debug(`<${id}> completed`);

    state.taken = true;
    emit('end', activityApi, executionContext);

    if (executionContext.takeAllOutbound()) {
      asyncEmit('leave', activityApi, executionContext);
    }
  }

  function getApi(executionContext) {
    return Api(executionContext);

    function Api() {
      const taskApi = {
        id,
        type,
        form: executionContext.getForm(),
        formKey: executionContext.getFormKey(),
        cancel,
        discard,
        getInput: executionContext.getInput,
        getOutput: executionContext.getOutput,
        getState: getExecutingState,
        stop
      };

      if (executionContext.isLoopContext) {
        taskApi.isLoopContext = true;
      }

      if (executionContext.signal) {
        taskApi.signal = executionContext.signal;
      }
      if (executionContext.iterations.length) {
        taskApi.loop = executionContext.iterations.map((itrExecution) => getApi(itrExecution));
      }

      return taskApi;

      function getExecutingState() {
        return Object.assign(getState(), executionContext.getState());
      }

      function cancel() {
        state.canceled = true;
        debug(`<${id}> cancel`);
        emit('cancel', activityApi, executionContext);
        complete(executionContext);
        executionContext.stop();
      }

      function discard() {
        executionContext.stop();
        discardAllOutbound(executionContext);
      }

      function stop() {
        executionContext.stop();
        deactivate();
      }
    }
  }

  function asyncEmit(eventName, ...args) {
    debug(`<${id}> async ${eventName}`);
    setImmediate(emit, eventName, ...args);
  }
};