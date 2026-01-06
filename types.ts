
export enum InputMode {
  RECORD = 'RECORD',
  UPLOAD = 'UPLOAD',
  PASTE = 'PASTE'
}

export enum OutputFormat {
  EMAIL = 'EMAIL',
  SUMMARY = 'SUMMARY',
  MEETING = 'MEETING',
  SOCIAL = 'SOCIAL',
  ACTION_ITEMS = 'ACTION_ITEMS',
  CUSTOM = 'CUSTOM'
}

export enum SummaryLength {
  SHORT = 'SHORT',
  MEDIUM = 'MEDIUM',
  LONG = 'LONG'
}

export interface AppSession {
  id: string;
  timestamp: number;
  transcript: string;
  output?: string;
  format?: OutputFormat;
}

export enum RecordingState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}
