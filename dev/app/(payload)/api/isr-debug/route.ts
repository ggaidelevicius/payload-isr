import {
  clearRevalidationEvents,
  getFullRebuildEvents,
  getIsrLogEvents,
  getIsrTraceEvents,
  getPathRevalidationEvents,
  getTagRevalidationEvents,
} from '../../../../helpers/revalidationRecorder.js'

const buildSnapshot = () => {
  const pathEvents = getPathRevalidationEvents()
  const tagEvents = getTagRevalidationEvents()
  const fullRebuildEvents = getFullRebuildEvents()
  const traceEvents = getIsrTraceEvents()
  const logEvents = getIsrLogEvents()

  return {
    counts: {
      fullRebuildEvents: fullRebuildEvents.length,
      logEvents: logEvents.length,
      pathEvents: pathEvents.length,
      tagEvents: tagEvents.length,
      traceEvents: traceEvents.length,
    },
    fullRebuildEvents,
    logEvents,
    pathEvents,
    tagEvents,
    traceEvents,
  }
}

export const GET = async () => {
  return Response.json(buildSnapshot())
}

export const DELETE = async () => {
  clearRevalidationEvents()
  return Response.json({
    cleared: true,
    counts: {
      fullRebuildEvents: 0,
      logEvents: 0,
      pathEvents: 0,
      tagEvents: 0,
      traceEvents: 0,
    },
  })
}
