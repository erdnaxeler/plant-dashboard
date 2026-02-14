import requests
import pandas as pd
from dash import Dash, html, dcc, Input, Output
import plotly.express as px

# ---- CONFIG ----
BUBBLE_ENDPOINT = "https://alex-43812.bubbleapps.io/api/1.1/wf/get_readings"

# ---- FETCH DATA ----
def fetch():

    r = requests.get(BUBBLE_ENDPOINT)
    r.raise_for_status()

    data = r.json()["response"]["results"]

    df = pd.DataFrame(data)

    # Convert Bubble timestamps (ms → datetime)
    if not df.empty and "Created Date" in df.columns:
        df["Created Date"] = pd.to_datetime(
            df["Created Date"], unit="ms", utc=True
        )

    if "moisture" in df.columns:
        df["moisture"] = pd.to_numeric(df["moisture"], errors="coerce")

    return df


# ---- DASH APP ----
app = Dash(__name__)
server = app.server

app.layout = html.Div(
    style={"maxWidth": "1100px", "margin": "0 auto", "padding": "16px"},
    children=[
        html.H1("Plant Moisture"),

        dcc.Graph(id="graph"),

        # refresh every 30 minutes
        dcc.Interval(id="refresh", interval=30 * 60 * 1000, n_intervals=0),
    ],
)


@app.callback(
    Output("graph", "figure"),
    Input("refresh", "n_intervals"),
)
def update_chart(_):

    df = fetch()

    if df.empty:
        return px.line(title="No data")

    fig = px.line(
        df.sort_values("Created Date"),
        x="Created Date",
        y="moisture",
        color="plant_name" if "plant_name" in df.columns else None,
        title="Moisture",
    )

    # Fix Y axis from 0 → 100
    fig.update_yaxes(range=[0, 100], autorange=False)

    # Hover shows ONLY moisture value
    fig.update_traces(
        hovertemplate="%{y}<extra></extra>"
    )

    fig.update_layout(
        margin=dict(l=20, r=20, t=50, b=20),
        hovermode="x unified"  # optional: cleaner hover behaviour
    )

    return fig


if __name__ == "__main__":
    app.run(debug=True)

