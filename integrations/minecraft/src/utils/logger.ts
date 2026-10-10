import { Format, LogLevel, setGlobalFormat, setGlobalLogLevel, useLogg } from '@guiiai/logg'

import { DebugService } from '../debug'

export type Logger = ReturnType<typeof useLogg>

export function initLogger() {
  setGlobalLogLevel(LogLevel.Debug)
  setGlobalFormat(Format.Pretty)

  const logger = useLogg('logger').useGlobalConfig()
  logger.log('Logger initialized')
}

/**
 * Get logger instance with directory name and filename
 * @returns logger instance configured with "directoryName/filename"
 */
export function useLogger() {
  const stack = new Error('logger').stack
  const caller = stack?.split('\n')[2]

  // Match the parent directory and filename without extension
  const match = caller?.match(/\/([^/]+)\/([^/]+?)\.[jt]s/)
  const dirName = match?.[1] || 'unknown'
  const fileName = match?.[2] || 'unknown'

  const logger = useLogg(`${dirName}/${fileName}`).useGlobalConfig()

  // Keep the complete logger contract while forwarding debug records.
  function withDebugRecords(target: Logger, fields: Record<string, unknown>): Logger {
    const overrides: Partial<Logger> = {
      useGlobalConfig: () => withDebugRecords(target.useGlobalConfig(), fields),
      child: more => withDebugRecords(target.child(more), { ...fields, ...more }),
      withContext: context => withDebugRecords(target.withContext(context), fields),
      withLogLevel: level => withDebugRecords(target.withLogLevel(level), fields),
      withLogLevelString: level => withDebugRecords(target.withLogLevelString(level), fields),
      withFormat: format => withDebugRecords(target.withFormat(format), fields),
      withCallStack: error => withDebugRecords(target.withCallStack(error), fields),
      withTimeFormatter: formatter => withDebugRecords(target.withTimeFormatter(formatter), fields),
      withErrorProcessor: processor => withDebugRecords(target.withErrorProcessor(processor), fields),
      log: (message: string, ...args: unknown[]) => {
        target.log(message, ...args)
        DebugService.getInstance().log('INFO', `[${dirName}/${fileName}] ${message}`, { ...fields, args })
      },
      error: (...parameters: Parameters<Logger['error']>) => {
        target.error(...parameters)
        const [message, ...args] = parameters
        DebugService.getInstance().log('ERROR', `[${dirName}/${fileName}] ${message}`, { ...fields, args })
      },
      warn: (message: string, ...args: unknown[]) => {
        target.warn(message, ...args)
        DebugService.getInstance().log('WARN', `[${dirName}/${fileName}] ${message}`, { ...fields, args })
      },
      withFields: more => withDebugRecords(target.withFields(more), { ...fields, ...more }),
      withField: (key, value) => withDebugRecords(target.withField(key, value), { ...fields, [key]: value }),
      withError: error => withDebugRecords(target.withError(error), { ...fields, error }),
      errorWithError: (message, error) => {
        target.errorWithError(message, error)
        DebugService.getInstance().log('ERROR', `[${dirName}/${fileName}] ${message}`, { ...fields, error })
      },
    }
    return new Proxy(target, {
      get(current, property) {
        if (Object.hasOwn(overrides, property))
          return Reflect.get(overrides, property)
        const member: unknown = Reflect.get(current, property)
        return typeof member === 'function' ? member.bind(current) : member
      },
    })
  }

  return withDebugRecords(logger, {})
}
