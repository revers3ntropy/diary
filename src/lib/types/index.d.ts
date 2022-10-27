export interface Label {
    id: string;
    colour: string;
    name: string;
}

export interface Entry {
    id: number;
    title: string;
    entry: string;
    created: number;
    latitude: number;
    longitude: number;
    deleted: number | boolean;
    label: Label;
}