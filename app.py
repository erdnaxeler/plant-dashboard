import requests
import pandas as pd
from dash import Dash, html, dcc
import plotly.express as px

BUBBLE_ENDPOINT = "https://alex-43812.bubbleapps.io/api/1.1/wf/get_readings"

def fetch():
    r = requests.get(BUBBLE_ENDPOINT)
    r.raise_for_status()
    data = r.json()["response"]["results"]
    df = pd.DataFrame(data)
    df["Created Date"] = pd.to_datetime(df["Created Date"])
    return df

df = fetch()

fig = px.line(
    df.sort_values("Created Date"),
    x="Created Date",
    y="moisture",
    color="plant_name"
)

app = Dash(__name__)
server = app.server

app.layout = html.Div([
    html.H3("Plant Moisture"),
    dcc.Graph(figure=fig)
])

if __name__ == "__main__":
    app.run(debug=True)

